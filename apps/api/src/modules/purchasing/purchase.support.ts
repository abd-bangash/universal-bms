import type {
  GoodsReceipt,
  Prisma,
  ProductVariant,
  PurchaseOrder,
  PurchaseOrderItem,
} from '@prisma/client';

export interface PurchaseItemDto {
  id: string;
  lineNo: number;
  variantId: string;
  sku: string;
  name: string;
  quantity: string;
  unitCost: string;
  receivedQty: string;
  returnedQty: string;
  lineTotal: string;
}

export interface PurchaseDto {
  id: string;
  orderNumber: string;
  supplierId: string;
  supplierName?: string;
  locationId: string;
  status: string;
  orderDate: string;
  expectedDate: string | null;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  /** Σ received quantity × cost, for the payables summary. */
  receivedValue?: string;
  notes: string | null;
  customFields: Record<string, unknown>;
  version: number;
  createdAt: string;
  items?: PurchaseItemDto[];
  receipts?: GoodsReceiptDto[];
}

export interface GoodsReceiptDto {
  id: string;
  receiptNumber: string;
  purchaseOrderId: string;
  receivedAt: string;
  receivedById: string | null;
  note: string | null;
  lines: Array<{
    purchaseOrderItemId: string;
    variantId: string;
    quantity: string;
    unitCost: string;
  }>;
}

export type ItemWithVariant = PurchaseOrderItem & {
  variant: ProductVariant & { product: { name: string } };
};

export const toItemDto = (i: ItemWithVariant): PurchaseItemDto => ({
  id: i.id,
  lineNo: i.lineNo,
  variantId: i.variantId,
  sku: i.variant.sku,
  name: i.variant.name ? `${i.variant.product.name} · ${i.variant.name}` : i.variant.product.name,
  quantity: i.quantity.toFixed(),
  unitCost: i.unitCost.toFixed(),
  receivedQty: i.receivedQty.toFixed(),
  returnedQty: i.returnedQty.toFixed(),
  lineTotal: i.lineTotal.toFixed(),
});

export const toPurchaseDto = (
  p: PurchaseOrder & { supplier?: { name: string } },
  extra: { items?: ItemWithVariant[]; receipts?: GoodsReceipt[] } = {},
): PurchaseDto => ({
  id: p.id,
  orderNumber: p.orderNumber,
  supplierId: p.supplierId,
  ...(p.supplier ? { supplierName: p.supplier.name } : {}),
  locationId: p.locationId,
  status: p.status,
  orderDate: p.orderDate.toISOString(),
  expectedDate: p.expectedDate ? p.expectedDate.toISOString() : null,
  subtotal: p.subtotal.toFixed(),
  taxAmount: p.taxAmount.toFixed(),
  totalAmount: p.totalAmount.toFixed(),
  notes: p.notes,
  customFields: p.customFields as Record<string, unknown>,
  version: p.version,
  createdAt: p.createdAt.toISOString(),
  ...(extra.items ? { items: extra.items.map(toItemDto) } : {}),
  ...(extra.receipts ? { receipts: extra.receipts.map(toReceiptDto) } : {}),
});

export const toReceiptDto = (r: GoodsReceipt): GoodsReceiptDto => ({
  id: r.id,
  receiptNumber: r.receiptNumber,
  purchaseOrderId: r.purchaseOrderId,
  receivedAt: r.receivedAt.toISOString(),
  receivedById: r.receivedById,
  note: r.note,
  lines: r.lines as unknown as GoodsReceiptDto['lines'],
});

export const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
