import type { Prisma } from '@prisma/client';

/** A document line ready to be written, after pricing and custom field validation. */
export interface LineRow {
  lineNo: number;
  kind: 'CATALOG' | 'CUSTOM';
  productId: string | null;
  variantId: string | null;
  name: string;
  sku: string | null;
  description: string | null;
  quantity: string;
  unitId: string | null;
  listPrice: string;
  unitPrice: string;
  discountType: string | null;
  discountValue: string;
  discountAmount: string;
  taxClassId: string | null;
  taxRate: string;
  taxAmount: string;
  lineTotal: string;
  customFields: Record<string, unknown>;
  fieldSnapshot: Array<{ key: string; label: string; value: string; unit: string | null }>;
  stockTracked: boolean;
  notes: string | null;
}

export interface DocumentTotals {
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  roundingAmount: string;
  totalAmount: string;
}

export const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
