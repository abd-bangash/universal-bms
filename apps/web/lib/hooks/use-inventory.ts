'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';

export interface StockRow {
  variantId: string;
  sku: string;
  productName: string;
  variantName: string | null;
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

export interface MovementView {
  id: string;
  variantId: string;
  locationId: string;
  movementType: string;
  sku: string | null;
  productName: string | null;
  quantityDelta: string;
  unitCost: string | null;
  referenceType: string | null;
  reasonId: string | null;
  note: string | null;
  createdAt: string;
}

export interface LocationView {
  id: string;
  name: string;
  type: 'STORE' | 'WAREHOUSE' | 'SHOWROOM' | 'DAMAGED';
  isDefault: boolean;
  active: boolean;
}

export interface ReasonView {
  id: string;
  name: string;
  active: boolean;
}

export const MOVEMENT_TYPES = [
  'OPENING_STOCK',
  'PURCHASE_RECEIPT',
  'ADJUSTMENT_IN',
  'TRANSFER_IN',
  'RETURN_IN',
  'SALE',
  'ADJUSTMENT_OUT',
  'TRANSFER_OUT',
  'RETURN_TO_SUPPLIER',
] as const;

export function useLocations(includeInactive = false) {
  return useQuery({
    queryKey: ['inventory', 'locations', includeInactive],
    queryFn: ({ signal }) =>
      api.get<LocationView[]>('/inventory/locations', { includeInactive }, signal),
  });
}

export function useAdjustmentReasons() {
  return useQuery({
    queryKey: ['inventory', 'reasons'],
    queryFn: ({ signal }) =>
      api.get<ReasonView[]>('/settings/adjustment-reasons', undefined, signal),
  });
}

/** How many variants are below their minimum level, for the home page. */
export function useLowStockCount(enabled: boolean) {
  return useQuery({
    queryKey: ['inventory', 'low-count'],
    enabled,
    queryFn: ({ signal }) =>
      api.getPage<StockRow>('/inventory/stock', { low: true, limit: 100 }, signal),
    select: (page) => page.items.length,
  });
}
