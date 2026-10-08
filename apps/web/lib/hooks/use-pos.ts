'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';
import type { OrderView } from './use-sales';

export interface PosSession {
  id: string;
  cashierId: string;
  locationId: string;
  status: string;
  openedAt: string;
  openingFloat: string;
}

export interface ReceiptRow {
  id: string;
  receiptNumber: string;
  orderId: string | null;
  orderNumber: string | null;
  customerName: string | null;
  type: string;
  issuedAt: string;
  totalAmount: string | null;
  reprintCount: number;
}

export interface CheckoutResult {
  order: OrderView;
  receipt: { id: string; receiptNumber: string };
  tendered: string;
  changeDue: string;
  session: PosSession;
}

export interface CheckoutBody {
  lines: Array<Record<string, unknown>>;
  orderDiscount?: { type: 'AMOUNT' | 'PERCENT'; value: string };
  customerId?: string;
  salespersonId?: string;
  payment: { paymentMethodId: string; tendered?: string; referenceNumber?: string };
}

export function usePosSession() {
  return useQuery({
    queryKey: ['pos', 'session'],
    queryFn: ({ signal }) => api.get<PosSession>('/pos/sessions/current', undefined, signal),
    staleTime: 5 * 60_000,
  });
}

/** Opens a receipt PDF in the browser's own viewer, where the print dialog is one click away. */
export async function openReceiptPdf(receiptId: string, paper?: string): Promise<void> {
  const blob = await api.blob(`/documents/receipts/${receiptId}/pdf`, { paper });
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank');
  if (!opened) window.location.assign(url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
