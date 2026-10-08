import type { GoodsReceipt, PurchaseOrder, Supplier } from '@prisma/client';
import type { DocumentSnapshot } from './document.types';
import { settingsPart } from './snapshot.builders';
import type { SnapshotSettings } from './snapshot-settings';
import type { ItemWithVariant } from '../purchasing/purchase.support';

export type PurchaseOrderSnapshot = DocumentSnapshot & { type: 'PURCHASE_ORDER' };

/** The purchase order as the supplier sees it: what we want, at what cost, delivered where and when. */
export function buildPurchaseOrderSnapshot(input: {
  purchase: PurchaseOrder;
  items: ItemWithVariant[];
  supplier: Supplier;
  settings: SnapshotSettings;
  receipts?: GoodsReceipt[];
}): PurchaseOrderSnapshot {
  const { purchase, items, supplier, settings } = input;
  return {
    type: 'PURCHASE_ORDER',
    number: purchase.orderNumber,
    issuedAt: purchase.orderDate.toISOString(),
    expectedDate: purchase.expectedDate ? purchase.expectedDate.toISOString() : null,
    ...settingsPart(settings, 'PURCHASE_ORDER'),
    customer: {
      name: supplier.name,
      phone: supplier.phone,
      email: supplier.email,
      address: supplier.address ? { line1: supplier.address } : null,
    },
    lines: [...items]
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((i) => ({
        id: i.id,
        lineNo: i.lineNo,
        kind: 'CATALOG',
        productId: i.variant.productId,
        variantId: i.variantId,
        name: i.variant.name
          ? `${i.variant.product.name} · ${i.variant.name}`
          : i.variant.product.name,
        sku: i.variant.sku,
        description: null,
        quantity: i.quantity.toFixed(),
        unitId: null,
        listPrice: i.unitCost.toFixed(),
        unitPrice: i.unitCost.toFixed(),
        discountType: null,
        discountValue: '0',
        discountAmount: '0',
        taxClassId: null,
        taxRate: '0',
        taxAmount: '0',
        lineTotal: i.lineTotal.toFixed(),
        customFields: {},
        fieldSnapshot: null,
      })),
    totals: {
      subtotal: purchase.subtotal.toFixed(),
      discountAmount: '0',
      taxAmount: purchase.taxAmount.toFixed(),
      totalAmount: purchase.totalAmount.toFixed(),
    },
    discount: { type: null, value: '0' },
    notes: purchase.notes,
    terms: null,
    bankDetails: null,
  };
}
