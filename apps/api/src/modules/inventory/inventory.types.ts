import type { MovementType } from '@prisma/client';

/** Movement types that add stock and those that take it away (design.md, Inventory). */
export const INBOUND_TYPES: ReadonlySet<MovementType> = new Set([
  'OPENING_STOCK',
  'PURCHASE_RECEIPT',
  'ADJUSTMENT_IN',
  'TRANSFER_IN',
  'RETURN_IN',
]);

export const isInbound = (type: MovementType): boolean => INBOUND_TYPES.has(type);

/** One movement as callers ask for it: a positive quantity in the base unit, signed by its type when posted. */
export interface MovementRequest {
  variantId: string;
  locationId: string;
  type: MovementType;
  /** Positive, in the product's base unit. */
  quantity: string;
  /** For inbound movements; updates the weighted average cost. */
  unitCost?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  reasonId?: string | null;
  note?: string | null;
  performedById?: string | null;
}

export interface PostedMovements {
  movementIds: string[];
  /** Variants and locations whose available stock has just fallen below the minimum level. */
  lowStock: Array<{ variantId: string; locationId: string }>;
}
