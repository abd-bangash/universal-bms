import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import { Prisma, type InventoryLocation, type StockMovement } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { D, roundHalfUp } from '../../common/money';
import { keysetCursor, keysetWhere, Page, toPage } from '../../common/pagination/pagination';
import { PrismaService, type ScopedTransaction } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import type {
  AdjustStockDto,
  CreateLocationDto,
  CreateReasonDto,
  ListMovementsQuery,
  ListStockQuery,
  OpeningStockDto,
  UpdateLocationDto,
  UpdateReasonDto,
} from './dto/inventory.dto';
import { InventoryService } from './inventory.service';
import type { MovementRequest } from './inventory.types';

export interface MovementDto {
  id: string;
  variantId: string;
  locationId: string;
  movementType: string;
  sku: string | null;
  productName: string | null;
  quantityDelta: string;
  unitCost: string | null;
  referenceType: string | null;
  referenceId: string | null;
  reasonId: string | null;
  note: string | null;
  performedById: string | null;
  createdAt: string;
}

export interface StockRowDto {
  variantId: string;
  sku: string;
  productId: string;
  productName: string;
  variantName: string | null;
  categoryId: string | null;
  onHand: string;
  reserved: string;
  available: string;
  avgCost: string;
  stockValue: string;
  minStockLevel: string | null;
  maxStockLevel: string | null;
  low: boolean;
  overstock: boolean;
}

export interface LocationDto {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
  active: boolean;
}

export interface ReasonDto {
  id: string;
  name: string;
  active: boolean;
}

type MovementRow = StockMovement & {
  variant?: { sku: string; product: { name: string } } | null;
};
const movementDto = (m: MovementRow): MovementDto => ({
  id: m.id,
  variantId: m.variantId,
  locationId: m.locationId,
  movementType: m.movementType,
  sku: m.variant?.sku ?? null,
  productName: m.variant?.product.name ?? null,
  quantityDelta: m.quantityDelta.toFixed(),
  unitCost: m.unitCost ? m.unitCost.toFixed() : null,
  referenceType: m.referenceType,
  referenceId: m.referenceId,
  reasonId: m.reasonId,
  note: m.note,
  performedById: m.performedById,
  createdAt: m.createdAt.toISOString(),
});
const locationDto = (l: InventoryLocation): LocationDto => ({
  id: l.id,
  name: l.name,
  type: l.type,
  isDefault: l.isDefault,
  active: l.active,
});
const audited = (v: object): Record<string, unknown> => v as Record<string, unknown>;
const refuse = (message: string, details?: Record<string, string[]>) =>
  new AppException('VALIDATION_FAILED', 422, message, details);

/** Opening stock, adjustments, the stock table, the movement list, locations and reasons (task 46). */
@Injectable()
export class StockOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  // ── writing ─────────────────────────────────────────────────────────────────────────────

  /** Opening stock per variant and location, at a unit cost. Entered once; later changes are adjustments. */
  async openingStock(user: AuthUser, dto: OpeningStockDto): Promise<MovementDto[]> {
    const locationId = await this.resolveLocation(dto.locationId);
    const seen = new Set<string>();
    const requests: MovementRequest[] = [];
    for (const [i, line] of dto.lines.entries()) {
      if (seen.has(line.variantId)) {
        throw new ValidationFailedException({ [`lines[${i}].variantId`]: ['appears twice'] });
      }
      seen.add(line.variantId);
      const quantity = await this.toBase(line.variantId, line.quantity, line.unit, `lines[${i}]`);
      if (D(line.unitCost).isNegative()) {
        throw new ValidationFailedException({ [`lines[${i}].unitCost`]: ['cannot be negative'] });
      }
      // a stored unit cost is per base unit
      const unitCost = D(line.unitCost).mul(D(line.quantity)).div(quantity);
      requests.push({
        variantId: line.variantId,
        locationId,
        type: 'OPENING_STOCK',
        quantity: quantity.toFixed(),
        unitCost: roundHalfUp(unitCost, 4).toFixed(),
        referenceType: 'OPENING',
        note: dto.note?.trim() || null,
        performedById: user.userId,
      });
    }
    const existing = await this.prisma.scoped.stockMovement.findMany({
      where: { locationId, variantId: { in: [...seen] } },
      select: { variantId: true },
      distinct: ['variantId'],
    });
    if (existing.length > 0) {
      throw refuse('Opening stock was already entered for some of these items; use an adjustment', {
        lines: existing.map((e) => e.variantId),
      });
    }
    return this.postAndAudit(user, requests, 'inventory.opening_stock');
  }

  /** A manual adjustment in or out, always with a reason from the workspace's list. */
  async adjust(user: AuthUser, dto: AdjustStockDto): Promise<MovementDto> {
    const reason = await this.prisma.scoped.adjustmentReason.findFirst({
      where: { id: dto.reasonId, active: true },
    });
    if (!reason)
      throw new ValidationFailedException({ reasonId: ['choose a reason from the list'] });
    const locationId = await this.resolveLocation(dto.locationId);
    const quantity = await this.toBase(dto.variantId, dto.quantity, dto.unit, 'quantity');
    const request: MovementRequest = {
      variantId: dto.variantId,
      locationId,
      type: dto.direction === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
      quantity: quantity.toFixed(),
      unitCost: dto.direction === 'IN' ? (dto.unitCost ?? null) : null,
      referenceType: 'ADJUSTMENT',
      reasonId: reason.id,
      note: dto.note?.trim() || null,
      performedById: user.userId,
    };
    const [movement] = await this.postAndAudit(user, [request], 'inventory.adjust');
    return movement as MovementDto;
  }

  private async postAndAudit(
    user: AuthUser,
    requests: MovementRequest[],
    action: string,
  ): Promise<MovementDto[]> {
    const { posted, rows } = await this.prisma.scoped.$transaction(async (tx) => {
      const result = await this.inventory.post(tx, user.workspaceId, requests);
      const created = await tx.stockMovement.findMany({
        where: { id: { in: result.movementIds } },
        orderBy: { createdAt: 'asc' },
      });
      for (const m of created) {
        await this.audit.record(tx, {
          action,
          entityType: 'StockMovement',
          entityId: m.id,
          after: audited(movementDto(m)),
        });
      }
      return { posted: result, rows: created };
    });
    await this.inventory.announce(user.workspaceId, user.userId, posted);
    return rows.map(movementDto);
  }

  // ── reading ─────────────────────────────────────────────────────────────────────────────

  /**
   * One row per stockable variant: on hand, reserved, available, average cost and value, with the
   * low and overstock flags, for one location or summed over all of them (Requirement 7.5, 37.11).
   */
  async stock(query: ListStockQuery): Promise<Page<StockRowDto>> {
    const workspaceId = this.requireWorkspace();
    const rows = await this.prisma.scoped.$queryRaw<
      Array<{
        variant_id: string;
        sku: string;
        product_id: string;
        product_name: string;
        variant_name: string | null;
        category_id: string | null;
        on_hand: Prisma.Decimal;
        reserved: Prisma.Decimal;
        avg_cost: Prisma.Decimal;
        min_stock: Prisma.Decimal | null;
        max_stock: Prisma.Decimal | null;
      }>
    >`
      SELECT * FROM (
        SELECT v.id AS variant_id, v.sku, p.id AS product_id, p.name AS product_name, v.name AS variant_name,
               p.category_id,
               COALESCE(SUM(sl.on_hand), 0) AS on_hand,
               COALESCE(SUM(sl.reserved), 0) AS reserved,
               CASE WHEN COALESCE(SUM(sl.on_hand) FILTER (WHERE sl.on_hand > 0), 0) > 0
                    THEN SUM(sl.on_hand * sl.avg_cost) FILTER (WHERE sl.on_hand > 0) / SUM(sl.on_hand) FILTER (WHERE sl.on_hand > 0)
                    ELSE 0 END AS avg_cost,
               v.min_stock_level AS min_stock, v.max_stock_level AS max_stock
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        LEFT JOIN stock_levels sl ON sl.variant_id = v.id
          ${query.locationId ? Prisma.sql`AND sl.location_id = ${query.locationId}` : Prisma.empty}
        WHERE v.workspace_id = ${workspaceId} AND p.type = 'STOCKABLE' AND v.status = 'ACTIVE'
          ${query.categoryId ? Prisma.sql`AND p.category_id = ${query.categoryId}` : Prisma.empty}
          ${query.q?.trim() ? Prisma.sql`AND (v.sku ILIKE ${`%${query.q.trim()}%`} OR p.name ILIKE ${`%${query.q.trim()}%`} OR v.name ILIKE ${`%${query.q.trim()}%`})` : Prisma.empty}
          ${query.cursor ? Prisma.sql`AND v.sku > ${decodeSku(query.cursor)}` : Prisma.empty}
        GROUP BY v.id, p.id
      ) s
      WHERE TRUE
        ${query.low ? Prisma.sql`AND s.min_stock IS NOT NULL AND (s.on_hand - s.reserved) < s.min_stock` : Prisma.empty}
        ${query.over ? Prisma.sql`AND s.max_stock IS NOT NULL AND s.on_hand > s.max_stock` : Prisma.empty}
      ORDER BY s.sku
      LIMIT ${query.limit + 1}`;
    const dtos = rows.map((r): StockRowDto => {
      const onHand = D(r.on_hand.toString());
      const reserved = D(r.reserved.toString());
      const avgCost = D(r.avg_cost.toString());
      const min = r.min_stock ? D(r.min_stock.toString()) : null;
      const max = r.max_stock ? D(r.max_stock.toString()) : null;
      const available = onHand.minus(reserved);
      return {
        variantId: r.variant_id,
        sku: r.sku,
        productId: r.product_id,
        productName: r.product_name,
        variantName: r.variant_name,
        categoryId: r.category_id,
        onHand: onHand.toFixed(),
        reserved: reserved.toFixed(),
        available: available.toFixed(),
        avgCost: roundHalfUp(avgCost, 4).toFixed(),
        stockValue: roundHalfUp(onHand.mul(avgCost), 4).toFixed(),
        minStockLevel: min?.toFixed() ?? null,
        maxStockLevel: max?.toFixed() ?? null,
        low: min !== null && available.lt(min),
        overstock: max !== null && onHand.gt(max),
      };
    });
    const hasMore = dtos.length > query.limit;
    const items = hasMore ? dtos.slice(0, query.limit) : dtos;
    return new Page(items, hasMore ? encodeSku(items[items.length - 1]?.sku ?? '') : undefined);
  }

  async movements(query: ListMovementsQuery): Promise<Page<MovementDto>> {
    const filters: Prisma.StockMovementWhereInput[] = [];
    if (query.variantId) filters.push({ variantId: query.variantId });
    if (query.locationId) filters.push({ locationId: query.locationId });
    if (query.type) filters.push({ movementType: query.type as StockMovement['movementType'] });
    if (query.referenceType) filters.push({ referenceType: query.referenceType });
    if (query.referenceId) filters.push({ referenceId: query.referenceId });
    if (query.userId) filters.push({ performedById: query.userId });
    if (query.from) filters.push({ createdAt: { gte: new Date(query.from) } });
    if (query.to) filters.push({ createdAt: { lte: new Date(query.to) } });
    const after = keysetWhere('createdAt', 'desc', query.cursor, true);
    if (after) filters.push(after as Prisma.StockMovementWhereInput);
    const rows = await this.prisma.scoped.stockMovement.findMany({
      where: { AND: filters },
      include: { variant: { select: { sku: true, product: { select: { name: true } } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) => keysetCursor(last.createdAt, last.id)).map(
      movementDto,
    );
  }

  // ── locations (Requirement 7.6) ─────────────────────────────────────────────────────────

  async locations(includeInactive = false): Promise<LocationDto[]> {
    const rows = await this.prisma.scoped.inventoryLocation.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return rows.map(locationDto);
  }

  async createLocation(user: AuthUser, dto: CreateLocationDto): Promise<LocationDto> {
    const name = dto.name.trim();
    await this.assertLocationNameFree(name);
    return this.prisma.scoped.$transaction(async (tx) => {
      if (dto.isDefault)
        await tx.inventoryLocation.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      const row = await tx.inventoryLocation.create({
        data: {
          workspaceId: user.workspaceId,
          name,
          type: dto.type ?? 'STORE',
          isDefault: dto.isDefault ?? false,
        },
      });
      await this.audit.record(tx, {
        action: 'location.create',
        entityType: 'InventoryLocation',
        entityId: row.id,
        after: audited(locationDto(row)),
      });
      return locationDto(row);
    });
  }

  async updateLocation(id: string, dto: UpdateLocationDto): Promise<LocationDto> {
    const existing = await this.prisma.scoped.inventoryLocation.findFirst({ where: { id } });
    if (!existing) throw new NotFoundAppException();
    const name = dto.name?.trim();
    if (name && name !== existing.name) await this.assertLocationNameFree(name);
    if (dto.active === false || dto.isDefault === false) {
      if (existing.isDefault) throw refuse('Choose another default location first');
    }
    if (dto.active === false) {
      const stock = await this.prisma.scoped.stockLevel.aggregate({
        where: { locationId: id },
        _sum: { onHand: true },
      });
      if (
        D((stock._sum.onHand ?? 0).toString())
          .abs()
          .gt(0)
      ) {
        throw refuse('This location still holds stock; move or adjust it first');
      }
    }
    return this.prisma.scoped
      .$transaction(async (tx) => {
        if (dto.isDefault)
          await tx.inventoryLocation.updateMany({
            where: { isDefault: true, id: { not: id } },
            data: { isDefault: false },
          });
        const row = await tx.inventoryLocation.update({
          where: { id },
          data: { name, type: dto.type, isDefault: dto.isDefault, active: dto.active },
        });
        await this.audit.record(tx, {
          action: 'location.update',
          entityType: 'InventoryLocation',
          entityId: id,
          before: audited(locationDto(existing)),
          after: audited(locationDto(row)),
        });
        return locationDto(row);
      })
      .then(async (updated) => {
        if (dto.isDefault) await this.settings.update({ inventory: { defaultLocationId: id } });
        return updated;
      });
  }

  // ── adjustment reasons (Requirement 37.2) ───────────────────────────────────────────────

  async reasons(includeInactive = false): Promise<ReasonDto[]> {
    const rows = await this.prisma.scoped.adjustmentReason.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, active: r.active }));
  }

  async createReason(user: AuthUser, dto: CreateReasonDto): Promise<ReasonDto> {
    const name = dto.name.trim();
    await this.assertReasonNameFree(name);
    return this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.adjustmentReason.create({
        data: { workspaceId: user.workspaceId, name },
      });
      await this.audit.record(tx, {
        action: 'adjustment_reason.create',
        entityType: 'AdjustmentReason',
        entityId: row.id,
        after: { name },
      });
      return { id: row.id, name: row.name, active: row.active };
    });
  }

  async updateReason(id: string, dto: UpdateReasonDto): Promise<ReasonDto> {
    const existing = await this.prisma.scoped.adjustmentReason.findFirst({ where: { id } });
    if (!existing) throw new NotFoundAppException();
    const name = dto.name?.trim();
    if (name && name.toLowerCase() !== existing.name.toLowerCase())
      await this.assertReasonNameFree(name);
    return this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.adjustmentReason.update({
        where: { id },
        data: { name, active: dto.active },
      });
      await this.audit.record(tx, {
        action: 'adjustment_reason.update',
        entityType: 'AdjustmentReason',
        entityId: id,
        before: { name: existing.name, active: existing.active },
        after: { name: row.name, active: row.active },
      });
      return { id: row.id, name: row.name, active: row.active };
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────

  private requireWorkspace(): string {
    const id = this.cls.get('workspaceId');
    if (!id) throw new Error('No workspace in context');
    return id;
  }

  /** The named location, or the workspace's default one. */
  private async resolveLocation(locationId: string | undefined): Promise<string> {
    if (locationId) {
      const location = await this.prisma.scoped.inventoryLocation.findFirst({
        where: { id: locationId, active: true },
      });
      if (!location) throw new ValidationFailedException({ locationId: ['does not exist'] });
      return location.id;
    }
    const configured = await this.settings.get<string | undefined>('inventory.defaultLocationId');
    const found =
      (configured
        ? await this.prisma.scoped.inventoryLocation.findFirst({
            where: { id: configured, active: true },
          })
        : null) ??
      (await this.prisma.scoped.inventoryLocation.findFirst({
        where: { isDefault: true, active: true },
      })) ??
      (await this.prisma.scoped.inventoryLocation.findFirst({
        where: { active: true },
        orderBy: { name: 'asc' },
      }));
    if (!found) throw refuse('Add an inventory location first');
    return found.id;
  }

  /** The quantity in the base unit: stock is only tracked for stockable products, in their base unit (Requirement 28.5). */
  private async toBase(
    variantId: string,
    quantity: string,
    unit: 'BASE' | 'SALE' | 'PURCHASE' | undefined,
    field: string,
  ) {
    const variant = await this.prisma.scoped.productVariant.findFirst({
      where: { id: variantId },
      include: { product: true },
    });
    if (!variant)
      throw new ValidationFailedException({ [field]: ['the product variant does not exist'] });
    if (variant.product.type !== 'STOCKABLE') {
      throw refuse(`${variant.sku} is not a stocked item`);
    }
    if (variant.status !== 'ACTIVE') throw refuse(`${variant.sku} is archived`);
    const factor =
      unit === 'SALE'
        ? D(variant.product.saleUnitFactor.toFixed())
        : unit === 'PURCHASE'
          ? D(variant.product.purchaseUnitFactor.toFixed())
          : D(1);
    const base = D(quantity).mul(factor);
    if (!base.gt(0)) throw new ValidationFailedException({ [field]: ['must be more than zero'] });
    return base;
  }

  private async assertLocationNameFree(name: string): Promise<void> {
    if (await this.prisma.scoped.inventoryLocation.findFirst({ where: { name } })) {
      throw new ValidationFailedException({ name: ['is already used by another location'] });
    }
  }

  private async assertReasonNameFree(name: string): Promise<void> {
    if (
      await this.prisma.scoped.adjustmentReason.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
      })
    ) {
      throw new ValidationFailedException({ name: ['is already used by another reason'] });
    }
  }
}

const encodeSku = (sku: string) => Buffer.from(sku).toString('base64url');
const decodeSku = (cursor: string) => Buffer.from(cursor, 'base64url').toString('utf8');

export type { ScopedTransaction };
