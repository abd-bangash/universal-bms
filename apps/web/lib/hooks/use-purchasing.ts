'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';

export interface SupplierSummary {
  totalOrdered: string;
  totalReceived: string;
  totalReturned: string;
  totalPaid: string;
  balance: string;
}

export interface SupplierView {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  customFields: Record<string, unknown>;
  createdAt: string;
  summary?: SupplierSummary;
}

export interface PurchaseItemView {
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

export interface GoodsReceiptView {
  id: string;
  receiptNumber: string;
  receivedAt: string;
  note: string | null;
  lines: Array<{ purchaseOrderItemId: string; quantity: string; unitCost: string }>;
}

export interface PurchaseView {
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
  receivedValue?: string;
  notes: string | null;
  version: number;
  items?: PurchaseItemView[];
  receipts?: GoodsReceiptView[];
  allowedTransitions?: Array<{ to: string }>;
}

export interface PurchaseHistoryRow {
  id: string;
  orderNumber: string;
  status: string;
  orderDate: string;
  totalAmount: string;
}

export function useActiveSuppliers() {
  return useQuery({
    queryKey: ['purchasing', 'supplier-options'],
    queryFn: ({ signal }) =>
      api.get<SupplierView[]>('/suppliers', { status: 'ACTIVE', limit: 100 }, signal),
  });
}

export function useSupplier(id: string) {
  return useQuery({
    queryKey: ['supplier', id],
    queryFn: ({ signal }) => api.get<SupplierView>(`/suppliers/${id}`, undefined, signal),
  });
}

export function usePurchase(id: string) {
  return useQuery({
    queryKey: ['purchase', id],
    queryFn: ({ signal }) => api.get<PurchaseView>(`/purchases/${id}`, undefined, signal),
  });
}
