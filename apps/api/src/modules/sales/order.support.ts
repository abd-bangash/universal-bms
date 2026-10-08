import type { Order, OrderItem, OrderSalesperson } from '@prisma/client';

export interface OrderLineDto {
  id: string;
  lineNo: number;
  kind: string;
  productId: string | null;
  variantId: string | null;
  name: string;
  sku: string | null;
  description: string | null;
  quantity: string;
  returnedQty: string;
  unitId: string | null;
  listPrice: string;
  unitPrice: string;
  /** Present only for users who hold product:view_cost. */
  costPrice?: string | null;
  discountType: string | null;
  discountValue: string;
  discountAmount: string;
  taxClassId: string | null;
  taxRate: string;
  taxAmount: string;
  lineTotal: string;
  stockTracked: boolean;
  notes: string | null;
  customFields: Record<string, unknown>;
  fieldSnapshot: unknown;
}

export interface OrderDto {
  id: string;
  orderNumber: string;
  customerId: string;
  leadId: string | null;
  quotationId: string | null;
  orderType: string;
  source: string;
  channel: string | null;
  campaign: string | null;
  locationId: string;
  status: string;
  paymentStatus: string;
  orderDate: string;
  subtotal: string;
  discountType: string | null;
  discountValue: string;
  discountAmount: string;
  taxAmount: string;
  roundingAmount: string;
  totalAmount: string;
  depositRequired: string;
  paidAmount: string;
  refundedAmount: string;
  returnedAmount: string;
  balanceDue: string;
  fulfilmentMethod: string | null;
  deliveryAddress: unknown;
  scheduledAt: string | null;
  deliveredAt: string | null;
  deliveredById: string | null;
  receiverName: string | null;
  proofFileId: string | null;
  notes: string | null;
  internalNotes: string | null;
  assignedToId: string | null;
  customFields: Record<string, unknown>;
  cancelledAt: string | null;
  cancelReason: string | null;
  closedAt: string | null;
  version: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  items?: OrderLineDto[];
  salespeople?: Array<{ userId: string; sharePercent: string }>;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const toOrderLineDto = (i: OrderItem, canViewCost: boolean): OrderLineDto => ({
  id: i.id,
  lineNo: i.lineNo,
  kind: i.kind,
  productId: i.productId,
  variantId: i.variantId,
  name: i.name,
  sku: i.sku,
  description: i.description,
  quantity: i.quantity.toFixed(),
  returnedQty: i.returnedQty.toFixed(),
  unitId: i.unitId,
  listPrice: i.listPrice.toFixed(),
  unitPrice: i.unitPrice.toFixed(),
  ...(canViewCost ? { costPrice: i.costPrice ? i.costPrice.toFixed() : null } : {}),
  discountType: i.discountType,
  discountValue: i.discountValue.toFixed(),
  discountAmount: i.discountAmount.toFixed(),
  taxClassId: i.taxClassId,
  taxRate: i.taxRate.toFixed(),
  taxAmount: i.taxAmount.toFixed(),
  lineTotal: i.lineTotal.toFixed(),
  stockTracked: i.stockTracked,
  notes: i.notes,
  customFields: i.customFields as Record<string, unknown>,
  fieldSnapshot: i.fieldSnapshot,
});

export const toOrderDto = (
  o: Order,
  options: { items?: OrderItem[]; salespeople?: OrderSalesperson[]; canViewCost?: boolean } = {},
): OrderDto => ({
  id: o.id,
  orderNumber: o.orderNumber,
  customerId: o.customerId,
  leadId: o.leadId,
  quotationId: o.quotationId,
  orderType: o.orderType,
  source: o.source,
  channel: o.channel,
  campaign: o.campaign,
  locationId: o.locationId,
  status: o.status,
  paymentStatus: o.paymentStatus,
  orderDate: o.orderDate.toISOString(),
  subtotal: o.subtotal.toFixed(),
  discountType: o.discountType,
  discountValue: o.discountValue.toFixed(),
  discountAmount: o.discountAmount.toFixed(),
  taxAmount: o.taxAmount.toFixed(),
  roundingAmount: o.roundingAmount.toFixed(),
  totalAmount: o.totalAmount.toFixed(),
  depositRequired: o.depositRequired.toFixed(),
  paidAmount: o.paidAmount.toFixed(),
  refundedAmount: o.refundedAmount.toFixed(),
  returnedAmount: o.returnedAmount.toFixed(),
  balanceDue: o.balanceDue.toFixed(),
  fulfilmentMethod: o.fulfilmentMethod,
  deliveryAddress: o.deliveryAddress,
  scheduledAt: iso(o.scheduledAt),
  deliveredAt: iso(o.deliveredAt),
  deliveredById: o.deliveredById,
  receiverName: o.receiverName,
  proofFileId: o.proofFileId,
  notes: o.notes,
  internalNotes: o.internalNotes,
  assignedToId: o.assignedToId,
  customFields: o.customFields as Record<string, unknown>,
  cancelledAt: iso(o.cancelledAt),
  cancelReason: o.cancelReason,
  closedAt: iso(o.closedAt),
  version: o.version,
  createdById: o.createdById,
  createdAt: o.createdAt.toISOString(),
  updatedAt: o.updatedAt.toISOString(),
  ...(options.items
    ? {
        items: [...options.items]
          .sort((a, b) => a.lineNo - b.lineNo)
          .map((i) => toOrderLineDto(i, options.canViewCost ?? false)),
      }
    : {}),
  ...(options.salespeople
    ? {
        salespeople: options.salespeople.map((s) => ({
          userId: s.userId,
          sharePercent: s.sharePercent.toFixed(),
        })),
      }
    : {}),
});
