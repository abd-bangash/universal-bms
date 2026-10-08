import { Injectable } from '@nestjs/common';
import type { Prisma, PurchaseOrder } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { D, roundHalfUp } from '../../common/money';
import {
  keysetCursor,
  keysetWhere,
  parseSort,
  toPage,
  type Page,
} from '../../common/pagination/pagination';
import { PrismaService, type ScopedTransaction } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FieldsService } from '../fields/fields.service';
import { InventoryService } from '../inventory/inventory.service';
import type { MovementRequest, PostedMovements } from '../inventory/inventory.types';
import { NumberingService } from '../numbering/numbering.service';
import { SettingsService } from '../settings/settings.service';
import { WorkflowService } from '../workflows/workflow.service';
import type {
  ChangePurchaseStatusDto,
  CreatePurchaseDto,
  ListPurchasesQuery,
  PurchaseLineDto,
  QuickPurchaseDto,
  ReceivePurchaseDto,
  UpdatePurchaseDto,
} from './dto/purchasing.dto';
import { RECEIPT_ROLES } from './purchase-workflow';
import {
  json,
  toPurchaseDto,
  toReceiptDto,
  type GoodsReceiptDto,
  type ItemWithVariant,
  type PurchaseDto,
} from './purchase.support';

const SORTS = ['orderDate', 'createdAt'] as const;
const refuse = (message: string, details?: Record<string, string[]>) =>
  new AppException('VALIDATION_FAILED', 422, message, details);
const COST_DECIMALS = 4;
const withVariant = { variant: { include: { product: { select: { name: true } } } } } as const;

interface PricedLine {
  variantId: string;
  quantity: string;
  unitCost: string;
  lineTotal: string;
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: FieldsService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly inventory: InventoryService,
    private readonly workflows: WorkflowService,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────────────────────────

  async list(query: ListPurchasesQuery): Promise<Page<PurchaseDto>> {
    const sort = parseSort(query.sort, SORTS, { field: 'orderDate', direction: 'desc' });
    const filters: Prisma.PurchaseOrderWhereInput[] = [];
    if (query.supplierId) filters.push({ supplierId: query.supplierId });
    if (query.status) filters.push({ status: query.status });
    if (query.from) filters.push({ orderDate: { gte: new Date(query.from) } });
    if (query.to) filters.push({ orderDate: { lte: new Date(query.to) } });
    if (query.q?.trim()) {
      const text = { contains: query.q.trim(), mode: 'insensitive' as const };
      filters.push({ OR: [{ orderNumber: text }, { supplier: { name: text } }] });
    }
    const after = keysetWhere(sort.field, sort.direction, query.cursor, true);
    if (after) filters.push(after as Prisma.PurchaseOrderWhereInput);
    const rows = await this.prisma.scoped.purchaseOrder.findMany({
      where: { AND: filters },
      include: { supplier: { select: { name: true } } },
      orderBy: [{ [sort.field]: sort.direction }, { id: sort.direction }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) =>
      keysetCursor(sort.field === 'createdAt' ? last.createdAt : last.orderDate, last.id),
    ).map((p) => toPurchaseDto(p));
  }

  async get(id: string): Promise<PurchaseDto & { allowedTransitions: unknown[] }> {
    const po = await this.prisma.scoped.purchaseOrder.findFirst({
      where: { id },
      include: {
        supplier: { select: { name: true } },
        items: { orderBy: { lineNo: 'asc' }, include: withVariant },
        receipts: { orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!po) throw new NotFoundAppException();
    const workflow = await this.workflows.get('PURCHASE_ORDER');
    const { items, receipts, ...rest } = po;
    const dto = toPurchaseDto(rest, { items: items as ItemWithVariant[], receipts });
    dto.receivedValue = items
      .reduce((sum, i) => sum.plus(D(i.receivedQty.toFixed()).mul(i.unitCost.toFixed())), D(0))
      .toFixed();
    return {
      ...dto,
      allowedTransitions: this.workflows
        .allowedTransitions(workflow, po.status)
        // receiving moves these states, not a button (Requirement 27.3)
        .filter((t) => !this.isReceiptState(workflow.states, t.to)),
    };
  }

  // ── create and edit ─────────────────────────────────────────────────────────────────────

  async create(user: AuthUser, dto: CreatePurchaseDto): Promise<PurchaseDto> {
    const prepared = await this.prepare(dto.supplierId, dto.lines, dto.taxAmount, dto.locationId);
    const customFields = await this.fields.validate('PURCHASE_ORDER', dto.customFields ?? {}, {});
    const id = await this.prisma.scoped.$transaction((tx) =>
      this.createInTx(tx, user, dto, prepared, customFields),
    );
    return this.get(id);
  }

  async update(user: AuthUser, id: string, dto: UpdatePurchaseDto): Promise<PurchaseDto> {
    const existing = await this.prisma.scoped.purchaseOrder.findFirst({ where: { id } });
    if (!existing) throw new NotFoundAppException();
    const role = await this.stateRole(existing.status);
    if (role === 'CANCELLED' || role === 'RECEIVED') {
      throw refuse(`A ${existing.status.replace('_', ' ')} order cannot be edited`);
    }
    const draft = role === 'DRAFT';
    if ((dto.lines !== undefined || dto.supplierId !== undefined) && !draft) {
      throw refuse('Lines and the supplier can only be changed while the order is a draft');
    }
    const supplierId = dto.supplierId ?? existing.supplierId;
    const prepared =
      dto.lines !== undefined
        ? await this.prepare(supplierId, dto.lines, dto.taxAmount ?? existing.taxAmount.toFixed())
        : null;
    if (dto.supplierId !== undefined && !prepared) await this.assertSupplier(supplierId);
    if (dto.locationId) await this.assertLocation(dto.locationId);
    const customFields =
      dto.customFields === undefined
        ? undefined
        : await this.fields.validate('PURCHASE_ORDER', dto.customFields, {
            existing: existing.customFields as Record<string, unknown>,
          });
    const taxAmount = dto.taxAmount ?? existing.taxAmount.toFixed();
    if (dto.taxAmount !== undefined && !prepared && !draft) {
      throw refuse('The tax can only be changed while the order is a draft');
    }
    const totals = prepared
      ? { subtotal: prepared.subtotal, totalAmount: prepared.total }
      : dto.taxAmount !== undefined
        ? {
            subtotal: existing.subtotal.toFixed(),
            totalAmount: D(existing.subtotal.toFixed()).plus(taxAmount).toFixed(),
          }
        : null;

    await this.prisma.scoped.$transaction(async (tx) => {
      const result = await tx.purchaseOrder.updateMany({
        where: { id, version: dto.version },
        data: {
          supplierId,
          locationId: dto.locationId,
          expectedDate:
            dto.expectedDate === undefined
              ? undefined
              : dto.expectedDate
                ? new Date(dto.expectedDate)
                : null,
          notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
          customFields: customFields ? json(customFields) : undefined,
          taxAmount: totals ? taxAmount : undefined,
          subtotal: totals?.subtotal,
          totalAmount: totals?.totalAmount,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        throw new AppException(
          'STALE_VERSION',
          409,
          'This purchase order was changed by someone else; reload and try again',
        );
      }
      if (prepared) {
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
        await this.writeItems(tx, user.workspaceId, id, prepared.lines);
      }
      const after = await tx.purchaseOrder.findFirstOrThrow({ where: { id } });
      await this.audit.record(tx, {
        action: 'purchase.update',
        entityType: 'PurchaseOrder',
        entityId: id,
        before: this.snapshot(existing),
        after: this.snapshot(after),
      });
    });
    return this.get(id);
  }

  async changeStatus(user: AuthUser, id: string, dto: ChangePurchaseStatusDto) {
    const workflow = await this.workflows.get('PURCHASE_ORDER');
    if (this.isReceiptState(workflow.states, dto.status)) {
      throw refuse('Received and partially received are set by receiving the goods');
    }
    const result = await this.workflows.transition('PURCHASE_ORDER', id, dto.status, {
      note: dto.note,
      actor: { userId: user.userId, permissions: user.permissions },
    });
    return {
      purchase: await this.get(id),
      pendingApproval: result.pendingApproval,
      ...(result.pendingApproval ? { approvalRequestId: result.approvalRequestId } : {}),
    };
  }

  // ── goods receipt (Requirement 7.9, design.md Purchasing) ───────────────────────────────

  /** Receives part or all of an order that has been sent. */
  async receive(
    user: AuthUser,
    id: string,
    dto: ReceivePurchaseDto,
  ): Promise<{ purchase: PurchaseDto; receipt: GoodsReceiptDto }> {
    const { receipt, posted } = await this.prisma.scoped.$transaction((tx) =>
      this.receiveInTx(tx, user, id, dto.lines, dto.note ?? null, false),
    );
    await this.inventory.announce(user.workspaceId, user.userId, posted);
    return { purchase: await this.get(id), receipt };
  }

  /** Creates an order and receives it in full, in one transaction (the quick purchase screen). */
  async quick(
    user: AuthUser,
    dto: QuickPurchaseDto,
  ): Promise<{ purchase: PurchaseDto; receipt: GoodsReceiptDto }> {
    const prepared = await this.prepare(dto.supplierId, dto.lines, dto.taxAmount, dto.locationId);
    const customFields = await this.fields.validate('PURCHASE_ORDER', dto.customFields ?? {}, {});
    const { id, receipt, posted } = await this.prisma.scoped.$transaction(async (tx) => {
      const poId = await this.createInTx(tx, user, dto, prepared, customFields);
      const items = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: poId },
        orderBy: { lineNo: 'asc' },
      });
      const done = await this.receiveInTx(
        tx,
        user,
        poId,
        items.map((i) => ({ itemId: i.id, quantity: i.quantity.toFixed() })),
        dto.receiptNote ?? null,
        true,
      );
      return { id: poId, ...done };
    });
    await this.inventory.announce(user.workspaceId, user.userId, posted);
    return { purchase: await this.get(id), receipt };
  }

  private async receiveInTx(
    tx: ScopedTransaction,
    user: AuthUser,
    id: string,
    lines: ReadonlyArray<{ itemId: string; quantity: string; unitCost?: string }>,
    note: string | null,
    allowDraft: boolean,
  ): Promise<{ receipt: GoodsReceiptDto; posted: PostedMovements }> {
    // lock the order so two receipts of the same order are applied one after the other
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id} FOR UPDATE`;
    const po = await tx.purchaseOrder.findFirst({ where: { id } });
    if (!po) throw new NotFoundAppException();
    const workflow = await this.workflows.get('PURCHASE_ORDER', tx);
    const role = workflow.states.find((s) => s.key === po.status)?.systemRole ?? null;
    if (role === 'DRAFT' && !allowDraft)
      throw refuse('Send the purchase order before receiving it');
    if (role === 'CANCELLED') throw refuse('A cancelled purchase order cannot be received');
    if (role === 'RECEIVED') throw refuse('This purchase order has already been received in full');

    const items = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId: id },
      include: { variant: { include: { product: true } } },
      orderBy: { lineNo: 'asc' },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    const mayOverReceive = user.permissions.includes('purchase:approve');
    const seen = new Set<string>();
    const requests: MovementRequest[] = [];
    const receiptLines: GoodsReceiptDto['lines'] = [];
    const over: Record<string, string[]> = {};
    const updates: Array<{ id: string; receivedQty: string }> = [];

    for (const [index, line] of lines.entries()) {
      const field = `lines[${index}]`;
      const item = byId.get(line.itemId);
      if (!item)
        throw new ValidationFailedException({ [`${field}.itemId`]: ['is not on this order'] });
      if (seen.has(item.id)) {
        throw new ValidationFailedException({ [`${field}.itemId`]: ['appears twice'] });
      }
      seen.add(item.id);
      const quantity = D(line.quantity);
      if (!quantity.gt(0)) {
        throw new ValidationFailedException({ [`${field}.quantity`]: ['must be more than zero'] });
      }
      const unitCost = line.unitCost === undefined ? D(item.unitCost.toFixed()) : D(line.unitCost);
      if (unitCost.isNegative()) {
        throw new ValidationFailedException({ [`${field}.unitCost`]: ['cannot be negative'] });
      }
      const receivedAfter = D(item.receivedQty.toFixed()).plus(quantity);
      if (receivedAfter.gt(item.quantity.toFixed()) && !mayOverReceive) {
        over[`${field}.quantity`] = [
          `only ${D(item.quantity.toFixed()).minus(item.receivedQty.toFixed()).toFixed()} left to receive`,
        ];
      }
      // stock is kept in the base unit; the cost is per base unit
      const factor = D(item.variant.product.purchaseUnitFactor.toFixed());
      const baseQuantity = quantity.mul(factor);
      requests.push({
        variantId: item.variantId,
        locationId: po.locationId,
        type: 'PURCHASE_RECEIPT',
        quantity: baseQuantity.toFixed(),
        unitCost: roundHalfUp(unitCost.div(factor), COST_DECIMALS).toFixed(),
        referenceType: 'PURCHASE',
        referenceId: po.id,
        note: note ?? null,
        performedById: user.userId,
      });
      receiptLines.push({
        purchaseOrderItemId: item.id,
        variantId: item.variantId,
        quantity: quantity.toFixed(),
        unitCost: unitCost.toFixed(),
      });
      updates.push({ id: item.id, receivedQty: receivedAfter.toFixed() });
    }
    if (Object.keys(over).length > 0) {
      throw new AppException(
        'VALIDATION_FAILED',
        422,
        'More than was ordered cannot be received',
        over,
      );
    }

    const posted = await this.inventory.post(tx, user.workspaceId, requests);
    for (const u of updates) {
      await tx.purchaseOrderItem.update({
        where: { id: u.id },
        data: { receivedQty: u.receivedQty },
      });
    }
    const receipt = await tx.goodsReceipt.create({
      data: {
        workspaceId: user.workspaceId,
        receiptNumber: await this.numbering.next(tx, 'GOODS_RECEIPT'),
        purchaseOrderId: id,
        receivedById: user.userId,
        note,
        lines: json(receiptLines),
      },
    });

    // the order is Received once every line has arrived in full, else Partially received
    const after = items.map((i) => {
      const u = updates.find((x) => x.id === i.id);
      return {
        ordered: D(i.quantity.toFixed()),
        received: D(u?.receivedQty ?? i.receivedQty.toFixed()),
      };
    });
    const complete = after.every((x) => x.received.gte(x.ordered));
    const target = workflow.states.find(
      (s) => s.active && s.systemRole === (complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED'),
    );
    if (!target)
      throw new AppException('INTERNAL_ERROR', 500, 'The purchase workflow has no received state');
    if (target.key !== po.status) {
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: target.key, version: { increment: 1 } },
      });
      await tx.statusHistory.create({
        data: {
          workspaceId: user.workspaceId,
          entityType: 'PURCHASE_ORDER',
          entityId: id,
          fromKey: po.status,
          toKey: target.key,
          changedById: user.userId,
          actorType: 'SYSTEM',
          note: `Goods receipt ${receipt.receiptNumber}`,
        },
      });
    }
    await this.audit.record(tx, {
      action: 'purchase.receive',
      entityType: 'PurchaseOrder',
      entityId: id,
      before: { status: po.status },
      after: { status: target.key, receiptNumber: receipt.receiptNumber },
      metadata: { lines: receiptLines },
    });
    return { receipt: toReceiptDto(receipt), posted };
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────

  private async createInTx(
    tx: ScopedTransaction,
    user: AuthUser,
    dto: { supplierId: string; expectedDate?: string | null; notes?: string | null },
    prepared: Awaited<ReturnType<PurchasesService['prepare']>>,
    customFields: Record<string, unknown>,
  ): Promise<string> {
    const initial = (await this.workflows.get('PURCHASE_ORDER', tx)).states.find(
      (s) => s.isInitial,
    );
    const po = await tx.purchaseOrder.create({
      data: {
        workspaceId: user.workspaceId,
        orderNumber: await this.numbering.next(tx, 'PURCHASE_ORDER'),
        supplierId: dto.supplierId,
        locationId: prepared.locationId,
        status: initial?.key ?? 'draft',
        expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
        subtotal: prepared.subtotal,
        taxAmount: prepared.tax,
        totalAmount: prepared.total,
        notes: dto.notes?.trim() || null,
        customFields: json(customFields),
        createdById: user.userId,
      },
    });
    await this.writeItems(tx, user.workspaceId, po.id, prepared.lines);
    await this.audit.record(tx, {
      action: 'purchase.create',
      entityType: 'PurchaseOrder',
      entityId: po.id,
      after: this.snapshot(po),
    });
    return po.id;
  }

  private async writeItems(
    tx: ScopedTransaction,
    workspaceId: string,
    purchaseOrderId: string,
    lines: PricedLine[],
  ): Promise<void> {
    for (const [index, line] of lines.entries()) {
      await tx.purchaseOrderItem.create({
        data: {
          workspaceId,
          purchaseOrderId,
          lineNo: index + 1,
          variantId: line.variantId,
          quantity: line.quantity,
          unitCost: line.unitCost,
          lineTotal: line.lineTotal,
        },
      });
    }
  }

  /** Checks the supplier, location and variants, fills in costs and totals. */
  private async prepare(
    supplierId: string,
    lines: PurchaseLineDto[],
    taxAmount: string | undefined,
    locationId?: string,
  ) {
    await this.assertSupplier(supplierId);
    const resolvedLocation = await this.resolveLocation(locationId);
    const variants = await this.prisma.scoped.productVariant.findMany({
      where: { id: { in: lines.map((l) => l.variantId) } },
      include: { product: true },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const decimals = await this.settings.get<number>('locale.currencyDecimals');
    const priced: PricedLine[] = [];
    const errors: Record<string, string[]> = {};
    for (const [index, line] of lines.entries()) {
      const variant = byId.get(line.variantId);
      const field = `lines[${index}]`;
      if (!variant) {
        errors[`${field}.variantId`] = ['the product variant does not exist'];
        continue;
      }
      if (variant.product.type !== 'STOCKABLE') {
        errors[`${field}.variantId`] = [`${variant.sku} is not a stocked item`];
        continue;
      }
      if (variant.status !== 'ACTIVE') {
        errors[`${field}.variantId`] = [`${variant.sku} is archived`];
        continue;
      }
      const quantity = D(line.quantity);
      if (!quantity.gt(0)) {
        errors[`${field}.quantity`] = ['must be more than zero'];
        continue;
      }
      const cost =
        line.unitCost ?? variant.costOverride?.toFixed() ?? variant.product.costPrice?.toFixed();
      if (cost === undefined || D(cost).isNegative()) {
        errors[`${field}.unitCost`] = [
          cost === undefined ? 'is required: the product has no cost price' : 'cannot be negative',
        ];
        continue;
      }
      priced.push({
        variantId: variant.id,
        quantity: quantity.toFixed(),
        unitCost: D(cost).toFixed(),
        lineTotal: roundHalfUp(quantity.mul(cost), decimals).toFixed(),
      });
    }
    if (Object.keys(errors).length > 0) throw new ValidationFailedException(errors);
    const tax = D(taxAmount ?? '0');
    if (tax.isNegative())
      throw new ValidationFailedException({ taxAmount: ['cannot be negative'] });
    const subtotal = priced.reduce((sum, l) => sum.plus(l.lineTotal), D(0));
    return {
      locationId: resolvedLocation,
      lines: priced,
      subtotal: subtotal.toFixed(),
      tax: tax.toFixed(),
      total: subtotal.plus(tax).toFixed(),
    };
  }

  private async assertSupplier(supplierId: string): Promise<void> {
    const supplier = await this.prisma.scoped.supplier.findFirst({ where: { id: supplierId } });
    if (!supplier) throw new ValidationFailedException({ supplierId: ['does not exist'] });
    if (supplier.status !== 'ACTIVE') {
      throw new ValidationFailedException({ supplierId: ['this supplier is archived'] });
    }
  }

  private async assertLocation(locationId: string): Promise<void> {
    const location = await this.prisma.scoped.inventoryLocation.findFirst({
      where: { id: locationId, active: true },
    });
    if (!location) throw new ValidationFailedException({ locationId: ['does not exist'] });
  }

  /** The location the goods go to: the one asked for, else the workspace's default. */
  private async resolveLocation(locationId?: string): Promise<string> {
    if (locationId) {
      await this.assertLocation(locationId);
      return locationId;
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

  private async stateRole(statusKey: string): Promise<string | null> {
    const workflow = await this.workflows.get('PURCHASE_ORDER');
    return workflow.states.find((s) => s.key === statusKey)?.systemRole ?? null;
  }

  private isReceiptState(
    states: ReadonlyArray<{ key: string; systemRole: string | null }>,
    key: string,
  ): boolean {
    const role = states.find((s) => s.key === key)?.systemRole;
    return !!role && (RECEIPT_ROLES as readonly string[]).includes(role);
  }

  private snapshot(po: PurchaseOrder): Record<string, unknown> {
    return { ...toPurchaseDto(po) } as unknown as Record<string, unknown>;
  }
}
