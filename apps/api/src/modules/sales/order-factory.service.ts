import { Injectable } from '@nestjs/common';
import type { Order, OrderItem } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { AppException } from '../../common/errors/app.exception';
import type { ScopedTransaction } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { SettingsService } from '../settings/settings.service';
import { WorkflowService } from '../workflows/workflow.service';
import { json, type DocumentTotals, type LineRow } from './line-rows';
import { toOrderDto } from './order.support';

export interface NewOrder {
  customerId: string;
  leadId?: string | null;
  quotationId?: string | null;
  orderType?: string;
  source?: string;
  channel?: string | null;
  campaign?: string | null;
  locationId?: string | null;
  assignedToId?: string | null;
  notes?: string | null;
  internalNotes?: string | null;
  customFields?: Record<string, unknown>;
  discount: { type: string; value: string } | null;
  totals: DocumentTotals;
  lines: LineRow[];
  orderDate?: Date;
}

/**
 * Writes an Order and its lines inside the caller's transaction: number, first workflow state and
 * its history row, salesperson share and audit. Used by order entry and by quotation conversion,
 * so an order looks the same whichever way it was made.
 */
@Injectable()
export class OrderFactory {
  constructor(
    private readonly numbering: NumberingService,
    private readonly workflows: WorkflowService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** The location stock is reserved from when the order does not name one. */
  async defaultLocationId(tx: ScopedTransaction): Promise<string> {
    const configured = await this.settings.get<string | undefined>('inventory.defaultLocationId');
    if (configured) return configured;
    const fallback =
      (await tx.inventoryLocation.findFirst({ where: { isDefault: true, active: true } })) ??
      (await tx.inventoryLocation.findFirst({ where: { active: true }, orderBy: { name: 'asc' } }));
    if (!fallback)
      throw new AppException('VALIDATION_FAILED', 422, 'Add an inventory location first');
    return fallback.id;
  }

  async create(
    tx: ScopedTransaction,
    user: AuthUser,
    input: NewOrder,
  ): Promise<{ order: Order; items: OrderItem[] }> {
    const [orderNumber, initial, locationId] = await Promise.all([
      this.numbering.next(tx, 'ORDER'),
      this.workflows.initialState('ORDER', tx),
      input.locationId ? Promise.resolve(input.locationId) : this.defaultLocationId(tx),
    ]);
    const order = await tx.order.create({
      data: {
        workspaceId: user.workspaceId,
        orderNumber,
        customerId: input.customerId,
        leadId: input.leadId ?? null,
        quotationId: input.quotationId ?? null,
        orderType: input.orderType ?? 'STANDARD',
        source: input.source ?? 'MANUAL',
        channel: input.channel ?? null,
        campaign: input.campaign ?? null,
        locationId,
        status: initial.key,
        orderDate: input.orderDate ?? new Date(),
        subtotal: input.totals.subtotal,
        discountType: input.discount?.type ?? null,
        discountValue: input.discount?.value ?? '0',
        discountAmount: input.totals.discountAmount,
        taxAmount: input.totals.taxAmount,
        roundingAmount: input.totals.roundingAmount,
        totalAmount: input.totals.totalAmount,
        balanceDue: input.totals.totalAmount,
        notes: input.notes ?? null,
        internalNotes: input.internalNotes ?? null,
        assignedToId: input.assignedToId ?? null,
        customFields: json(input.customFields ?? {}),
        createdById: user.userId,
      },
    });
    for (const line of input.lines) {
      await tx.orderItem.create({
        data: {
          workspaceId: user.workspaceId,
          orderId: order.id,
          lineNo: line.lineNo,
          kind: line.kind,
          productId: line.productId,
          variantId: line.variantId,
          name: line.name,
          sku: line.sku,
          description: line.description,
          quantity: line.quantity,
          unitId: line.unitId,
          listPrice: line.listPrice,
          unitPrice: line.unitPrice,
          discountType: line.discountType,
          discountValue: line.discountValue,
          discountAmount: line.discountAmount,
          taxClassId: line.taxClassId,
          taxRate: line.taxRate,
          taxAmount: line.taxAmount,
          lineTotal: line.lineTotal,
          stockTracked: line.stockTracked,
          notes: line.notes,
          customFields: json(line.customFields),
          fieldSnapshot: json(line.fieldSnapshot),
        },
      });
    }
    // Release 1: one salesperson at 100 percent (design.md Orders)
    if (input.assignedToId) {
      await tx.orderSalesperson.create({
        data: {
          workspaceId: user.workspaceId,
          orderId: order.id,
          userId: input.assignedToId,
          sharePercent: '100',
        },
      });
    }
    await tx.statusHistory.create({
      data: {
        workspaceId: user.workspaceId,
        entityType: 'ORDER',
        entityId: order.id,
        fromKey: null,
        toKey: initial.key,
        changedById: user.userId,
      },
    });
    const items = await tx.orderItem.findMany({
      where: { orderId: order.id },
      orderBy: { lineNo: 'asc' },
    });
    await this.audit.record(tx, {
      action: 'order.create',
      entityType: 'Order',
      entityId: order.id,
      after: toOrderDto(order) as unknown as Record<string, unknown>,
      metadata: { lines: items.length, quotationId: input.quotationId ?? null },
    });
    return { order, items };
  }
}
