import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app.exception';
import { D, type Dec } from '../../common/money';
import type { ScopedTransaction } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { InventoryService, keyOf } from './inventory.service';
import type { PostedMovements } from './inventory.types';

export interface ShortLine {
  lineNo: number;
  variantId: string;
  name: string;
  requested: string;
  available: string;
}

/**
 * Reserves stock for a confirmed order, gives it back when the order is cancelled, and turns the
 * reservation into a sale when it is delivered (design.md, Inventory; Requirements 7.4, 11.6, 11.7).
 * All three run in the transaction of the status change, so they succeed or fail with it.
 */
@Injectable()
export class ReservationsService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly settings: SettingsService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  /** Quantity of an order line in the base unit the stock is kept in. */
  private baseQuantity(
    quantity: { toFixed(): string },
    saleUnitFactor: { toFixed(): string },
  ): Dec {
    return D(quantity.toFixed()).mul(saleUnitFactor.toFixed());
  }

  /**
   * Reserves every stock-tracked line that is not reserved yet. When the available stock does not
   * cover a line the whole confirmation fails with 409 INSUFFICIENT_STOCK naming those lines.
   */
  async reserve(tx: ScopedTransaction, orderId: string): Promise<void> {
    const order = await tx.order.findFirstOrThrow({ where: { id: orderId } });
    const items = await tx.orderItem.findMany({
      where: { orderId, stockTracked: true, variantId: { not: null } },
      orderBy: { lineNo: 'asc' },
    });
    const reserved = new Set(
      (
        await tx.stockReservation.findMany({
          where: { orderId, status: 'ACTIVE' },
          select: { orderItemId: true },
        })
      ).map((r) => r.orderItemId),
    );
    const todo = items.filter((i) => !reserved.has(i.id));
    if (todo.length === 0) return;

    const variants = await tx.productVariant.findMany({
      where: { id: { in: todo.map((i) => i.variantId as string) } },
      include: { product: true },
    });
    const factor = new Map(variants.map((v) => [v.id, v.product.saleUnitFactor]));
    const levels = await this.inventory.lockLevels(
      tx,
      order.workspaceId,
      todo.map((i) => ({ variantId: i.variantId as string, locationId: order.locationId })),
    );
    const allowNegative = await this.settings.get<boolean>('inventory.allowNegativeStock');

    const short: ShortLine[] = [];
    const take = new Map<string, Dec>();
    const wanted = todo.map((item) => ({
      item,
      quantity: this.baseQuantity(
        item.quantity,
        factor.get(item.variantId as string) ?? { toFixed: () => '1' },
      ),
    }));
    for (const { item, quantity } of wanted) {
      const key = keyOf(item.variantId as string, order.locationId);
      const level = levels.get(key);
      if (!level) continue;
      const alreadyTaken = take.get(key) ?? D(0);
      const available = level.onHand.minus(level.reserved).minus(alreadyTaken);
      if (!allowNegative && available.lt(quantity)) {
        short.push({
          lineNo: item.lineNo,
          variantId: item.variantId as string,
          name: item.name,
          requested: quantity.toFixed(),
          available: available.lt(0) ? '0' : available.toFixed(),
        });
      }
      take.set(key, alreadyTaken.plus(quantity));
    }
    if (short.length > 0) {
      throw new AppException(
        'INSUFFICIENT_STOCK',
        409,
        'There is not enough stock for some lines',
        undefined,
        { lines: short },
      );
    }
    for (const { item, quantity } of wanted) {
      await tx.stockReservation.create({
        data: {
          workspaceId: order.workspaceId,
          orderId,
          orderItemId: item.id,
          variantId: item.variantId as string,
          locationId: order.locationId,
          quantity: quantity.toFixed(),
        },
      });
    }
    for (const [key, quantity] of take) {
      const level = levels.get(key);
      if (!level) continue;
      await tx.stockLevel.update({
        where: { id: level.id },
        data: { reserved: level.reserved.plus(quantity).toFixed() },
      });
    }
  }

  /** Gives back what an order still holds (a cancelled order, Requirement 11.7). */
  async release(tx: ScopedTransaction, orderId: string): Promise<void> {
    await this.close(tx, orderId, 'RELEASED');
  }

  /**
   * Delivery turns the reservations into sales: the reserved quantity goes, a SALE movement is
   * posted, and the line keeps the average cost at that moment (Requirement 37.8).
   */
  async fulfil(
    tx: ScopedTransaction,
    orderId: string,
    performedById: string | null,
  ): Promise<void> {
    const order = await tx.order.findFirstOrThrow({ where: { id: orderId } });
    const closed = await this.close(tx, orderId, 'FULFILLED');
    if (closed.length === 0) return;
    const levels = await this.inventory.lockLevels(tx, order.workspaceId, closed);
    for (const r of closed) {
      const level = levels.get(keyOf(r.variantId, r.locationId));
      const item = await tx.orderItem.findFirst({ where: { id: r.orderItemId } });
      if (!level || !item) continue;
      const unitFactor = D(item.quantity.toFixed()).gt(0)
        ? r.quantity.div(item.quantity.toFixed())
        : D(1);
      await tx.orderItem.update({
        where: { id: item.id },
        data: { costPrice: level.avgCost.mul(unitFactor).toDecimalPlaces(4).toFixed() },
      });
    }
    const posted = await this.inventory.post(
      tx,
      order.workspaceId,
      closed.map((r) => ({
        variantId: r.variantId,
        locationId: r.locationId,
        type: 'SALE' as const,
        quantity: r.quantity.toFixed(),
        referenceType: 'ORDER',
        referenceId: orderId,
        performedById,
      })),
    );
    this.defer(posted);
  }

  /** Marks the order's active reservations closed and takes them out of the reserved quantity. */
  private async close(
    tx: ScopedTransaction,
    orderId: string,
    status: 'RELEASED' | 'FULFILLED',
  ): Promise<Array<{ variantId: string; locationId: string; quantity: Dec; orderItemId: string }>> {
    const active = await tx.stockReservation.findMany({ where: { orderId, status: 'ACTIVE' } });
    if (active.length === 0) return [];
    const levels = await this.inventory.lockLevels(tx, active[0]?.workspaceId as string, active);
    const out: Array<{
      variantId: string;
      locationId: string;
      quantity: Dec;
      orderItemId: string;
    }> = [];
    for (const r of active) {
      const level = levels.get(keyOf(r.variantId, r.locationId));
      const quantity = D(r.quantity.toFixed());
      if (level) {
        level.reserved = level.reserved.minus(quantity);
        await tx.stockLevel.update({
          where: { id: level.id },
          data: { reserved: level.reserved.toFixed() },
        });
      }
      await tx.stockReservation.update({
        where: { id: r.id },
        data: { status, closedAt: new Date() },
      });
      out.push({
        variantId: r.variantId,
        locationId: r.locationId,
        quantity,
        orderItemId: r.orderItemId,
      });
    }
    return out;
  }

  /** Remembers movements posted inside a workflow transaction until the request has committed it. */
  private defer(posted: PostedMovements): void {
    const pending = this.cls.get('pendingStock') ?? [];
    pending.push(posted);
    this.cls.set('pendingStock', pending);
  }

  /** Announces the movements that have committed (low stock, movement posted). Call after the transition returns. */
  async announcePending(workspaceId: string, actorUserId: string | null): Promise<void> {
    const pending = this.cls.get('pendingStock') ?? [];
    this.cls.set('pendingStock', []);
    for (const posted of pending) await this.inventory.announce(workspaceId, actorUserId, posted);
  }
}
