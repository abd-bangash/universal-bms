import { Injectable } from '@nestjs/common';
import type { StockMovement } from '@prisma/client';
import { AppException, ValidationFailedException } from '../../common/errors/app.exception';
import { DomainEventBus } from '../../common/events/domain-event-bus';
import { D, roundHalfUp, type Dec } from '../../common/money';
import { PrismaService, type ScopedTransaction } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { isInbound, type MovementRequest, type PostedMovements } from './inventory.types';

const COST_DECIMALS = 4;

interface LevelState {
  id: string;
  variantId: string;
  locationId: string;
  onHand: Dec;
  reserved: Dec;
  avgCost: Dec;
  wasLow: boolean;
  minLevel: Dec | null;
}

const keyOf = (variantId: string, locationId: string) => `${variantId}\u0000${locationId}`;

/**
 * The single writer of the stock ledger (Requirements 7, 37). `post` locks the affected levels in
 * a fixed order, applies the negative-stock rule to available stock, appends the movements and
 * updates the on-hand quantity and weighted average cost, all inside the caller's transaction.
 * Call `announce` once that transaction has committed.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly events: DomainEventBus,
  ) {}

  /** Appends movements to the ledger and updates the levels. Quantities are positive; the type gives the sign. */
  async post(
    tx: ScopedTransaction,
    workspaceId: string,
    requests: readonly MovementRequest[],
  ): Promise<PostedMovements> {
    if (requests.length === 0) return { movementIds: [], lowStock: [] };
    for (const r of requests) {
      if (!D(r.quantity).gt(0)) {
        throw new ValidationFailedException({ quantity: ['must be more than zero'] });
      }
    }
    const allowNegative = await this.settings.get<boolean>('inventory.allowNegativeStock');
    const levels = await this.lockLevels(tx, workspaceId, requests);

    const created: StockMovement[] = [];
    for (const r of requests) {
      const level = levels.get(keyOf(r.variantId, r.locationId)) as LevelState;
      const quantity = D(r.quantity);
      const delta = isInbound(r.type) ? quantity : quantity.negated();
      if (delta.isNegative() && !allowNegative) {
        const available = level.onHand.minus(level.reserved);
        if (available.plus(delta).isNegative()) {
          throw new AppException(
            'INSUFFICIENT_STOCK',
            409,
            `Only ${available.toFixed()} available`,
            undefined,
            {
              variantId: r.variantId,
              locationId: r.locationId,
              available: available.toFixed(),
              requested: quantity.toFixed(),
            },
          );
        }
      }
      if (delta.gt(0) && r.unitCost !== undefined && r.unitCost !== null) {
        const cost = D(r.unitCost);
        level.avgCost = level.onHand.lte(0)
          ? cost
          : roundHalfUp(
              level.onHand.mul(level.avgCost).plus(delta.mul(cost)).div(level.onHand.plus(delta)),
              COST_DECIMALS,
            );
      }
      level.onHand = level.onHand.plus(delta);
      created.push(
        await tx.stockMovement.create({
          data: {
            workspaceId,
            variantId: r.variantId,
            locationId: r.locationId,
            movementType: r.type,
            quantityDelta: delta.toFixed(),
            unitCost: r.unitCost ?? null,
            referenceType: r.referenceType ?? null,
            referenceId: r.referenceId ?? null,
            reasonId: r.reasonId ?? null,
            note: r.note ?? null,
            performedById: r.performedById ?? null,
          },
        }),
      );
    }
    for (const level of levels.values()) {
      await tx.stockLevel.update({
        where: { id: level.id },
        data: { onHand: level.onHand.toFixed(), avgCost: level.avgCost.toFixed() },
      });
    }
    return {
      movementIds: created.map((m) => m.id),
      lowStock: [...levels.values()]
        .filter(
          (l) => l.minLevel !== null && !l.wasLow && l.onHand.minus(l.reserved).lt(l.minLevel),
        )
        .map((l) => ({ variantId: l.variantId, locationId: l.locationId })),
    };
  }

  /** Publishes the events for movements that have committed. */
  async announce(
    workspaceId: string,
    actorUserId: string | null,
    posted: PostedMovements,
  ): Promise<void> {
    if (posted.movementIds.length === 0) return;
    await this.events.publish('stock.movement_posted', {
      workspaceId,
      movementIds: posted.movementIds,
      actorUserId,
    });
    for (const low of posted.lowStock) {
      await this.events.publish('stock.low', { workspaceId, ...low, actorUserId });
    }
  }

  /**
   * Makes sure a level row exists for every variant and location involved, then locks them all in
   * one fixed order so that two operations touching the same stock cannot deadlock or both take
   * the last unit (Requirement 37.6).
   */
  private async lockLevels(
    tx: ScopedTransaction,
    workspaceId: string,
    requests: readonly MovementRequest[],
  ): Promise<Map<string, LevelState>> {
    const pairs = [
      ...new Map(requests.map((r) => [keyOf(r.variantId, r.locationId), r] as const)).values(),
    ].sort((a, b) =>
      keyOf(a.variantId, a.locationId).localeCompare(keyOf(b.variantId, b.locationId)),
    );
    await tx.stockLevel.createMany({
      data: pairs.map((p) => ({ workspaceId, variantId: p.variantId, locationId: p.locationId })),
      skipDuplicates: true,
    });
    const levels = new Map<string, LevelState>();
    for (const p of pairs) {
      const rows = await tx.$queryRaw<
        Array<{ id: string; on_hand: string; reserved: string; avg_cost: string }>
      >`
        SELECT id, on_hand::text, reserved::text, avg_cost::text FROM stock_levels
        WHERE workspace_id = ${workspaceId} AND variant_id = ${p.variantId} AND location_id = ${p.locationId}
        FOR UPDATE`;
      const row = rows[0] as { id: string; on_hand: string; reserved: string; avg_cost: string };
      const variant = await tx.productVariant.findFirst({
        where: { id: p.variantId },
        select: { minStockLevel: true },
      });
      const onHand = D(row.on_hand);
      const reserved = D(row.reserved);
      const minLevel = variant?.minStockLevel ? D(variant.minStockLevel.toFixed()) : null;
      levels.set(keyOf(p.variantId, p.locationId), {
        id: row.id,
        variantId: p.variantId,
        locationId: p.locationId,
        onHand,
        reserved,
        avgCost: D(row.avg_cost),
        minLevel,
        wasLow: minLevel !== null && onHand.minus(reserved).lt(minLevel),
      });
    }
    return levels;
  }
}
