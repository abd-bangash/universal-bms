'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';

export interface LineView {
  id: string;
  lineNo: number;
  kind: 'CATALOG' | 'CUSTOM';
  productId: string | null;
  variantId: string | null;
  name: string;
  sku: string | null;
  description: string | null;
  quantity: string;
  listPrice: string;
  unitPrice: string;
  discountType: 'AMOUNT' | 'PERCENT' | null;
  discountValue: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  lineTotal: string;
  customFields: Record<string, unknown>;
  fieldSnapshot: Array<{ key: string; label: string; value: string; unit: string | null }> | null;
  notes?: string | null;
}

export type QuotationStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED';

export interface QuotationView {
  id: string;
  quotationNumber: string;
  customerId: string | null;
  leadId: string | null;
  status: QuotationStatus;
  validUntil: string | null;
  subtotal: string;
  discountType: 'AMOUNT' | 'PERCENT' | null;
  discountValue: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  notes: string | null;
  terms: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  acceptedVia: string | null;
  rejectedReason: string | null;
  customFields: Record<string, unknown>;
  version: number;
  createdAt: string;
  items?: LineView[];
}

export interface OrderView {
  id: string;
  orderNumber: string;
  customerId: string;
  leadId: string | null;
  quotationId: string | null;
  orderType: string;
  source: string;
  status: string;
  paymentStatus: string;
  orderDate: string;
  subtotal: string;
  discountType: 'AMOUNT' | 'PERCENT' | null;
  discountValue: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  depositRequired: string;
  paidAmount: string;
  refundedAmount: string;
  balanceDue: string;
  fulfilmentMethod: 'PICKUP' | 'DELIVERY' | null;
  deliveryAddress: Record<string, string> | null;
  scheduledAt: string | null;
  deliveredAt: string | null;
  receiverName: string | null;
  notes: string | null;
  internalNotes: string | null;
  cancelReason: string | null;
  version: number;
  items?: LineView[];
  allowedTransitions?: Array<{
    to: string;
    requiredPermission: string | null;
    requiredFields: string[];
    requiresApproval: boolean;
  }>;
}

export interface WorkflowStateView {
  key: string;
  label: string;
  color: string;
  category: string;
  systemRole: string | null;
  active: boolean;
}

export interface VariantPick {
  variantId: string;
  productName: string;
  variantName: string | null;
  sku: string;
  price: string;
  availableStock: string | null;
}

export interface InvoiceView {
  id: string;
  invoiceNumber: string;
  issuedAt: string;
  totalAmount: string;
}

/** A line while it is being edited: strings as typed, no computed amounts. */
export interface LineDraft {
  key: string;
  kind: 'CATALOG' | 'CUSTOM';
  variantId?: string;
  name: string;
  sku: string | null;
  quantity: string;
  /** Empty means "the catalog price"; filled means a manual price (needs order:price_override). */
  unitPrice: string;
  listPrice: string;
  discountType: '' | 'AMOUNT' | 'PERCENT';
  discountValue: string;
  customFields: Record<string, unknown>;
  notes: string;
}

let counter = 0;
export const newLineKey = () => `line-${++counter}`;

export function draftFromLine(l: LineView): LineDraft {
  const overridden = l.kind === 'CUSTOM' || l.unitPrice !== l.listPrice;
  return {
    key: newLineKey(),
    kind: l.kind,
    variantId: l.variantId ?? undefined,
    name: l.name,
    sku: l.sku,
    quantity: l.quantity,
    unitPrice: overridden ? l.unitPrice : '',
    listPrice: l.listPrice,
    discountType: l.discountType ?? '',
    discountValue: l.discountType ? l.discountValue : '',
    customFields: l.customFields,
    notes: l.notes ?? '',
  };
}

export function draftFromVariant(v: VariantPick): LineDraft {
  return {
    key: newLineKey(),
    kind: 'CATALOG',
    variantId: v.variantId,
    name: v.variantName ? `${v.productName} · ${v.variantName}` : v.productName,
    sku: v.sku,
    quantity: '1',
    unitPrice: '',
    listPrice: v.price,
    discountType: '',
    discountValue: '',
    customFields: {},
    notes: '',
  };
}

export const customDraft = (): LineDraft => ({
  key: newLineKey(),
  kind: 'CUSTOM',
  name: '',
  sku: null,
  quantity: '1',
  unitPrice: '',
  listPrice: '0',
  discountType: '',
  discountValue: '',
  customFields: {},
  notes: '',
});

/** The line as the API takes it. */
export function toLineInput(d: LineDraft): Record<string, unknown> {
  return {
    kind: d.kind,
    ...(d.kind === 'CATALOG' ? { variantId: d.variantId } : { name: d.name.trim() }),
    quantity: d.quantity || '0',
    ...(d.unitPrice !== '' ? { unitPrice: d.unitPrice } : {}),
    ...(d.discountType && d.discountValue !== ''
      ? { discount: { type: d.discountType, value: d.discountValue } }
      : {}),
    customFields: d.customFields,
    ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
  };
}

export interface PreviewTotals {
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  roundingAmount: string;
  total: string;
}

export function useVariantSearch(q: string) {
  const text = q.trim();
  return useQuery({
    queryKey: ['variant-search', text],
    enabled: text.length >= 2,
    queryFn: ({ signal }) =>
      api.get<VariantPick[]>('/catalog/variants/search', { q: text, limit: 8 }, signal),
  });
}

export function useWorkflowStates(entityType: 'ORDER' | 'PURCHASE_ORDER') {
  return useQuery({
    queryKey: ['workflow', entityType],
    queryFn: ({ signal }) =>
      api.get<{ states: WorkflowStateView[] }>(`/workflows/${entityType}`, undefined, signal),
    select: (w) => w.states,
  });
}

export function usePricingPreview(
  lines: LineDraft[],
  orderDiscount: { type: 'AMOUNT' | 'PERCENT'; value: string } | null,
  customerId: string | null,
  cash = false,
) {
  const valid = lines.filter(
    (l) => (l.kind === 'CATALOG' ? !!l.variantId : l.name.trim() !== '') && l.quantity !== '',
  );
  const body = {
    lines: valid.map(toLineInput),
    ...(orderDiscount && orderDiscount.value !== '' ? { orderDiscount } : {}),
    ...(customerId ? { customerId } : {}),
    ...(cash ? { cash: true } : {}),
  };
  return useQuery({
    queryKey: ['pricing-preview', body],
    enabled: valid.length > 0,
    placeholderData: (previous) => previous,
    queryFn: () =>
      api.post<PreviewTotals & { lines: Array<{ lineNo: number; lineTotal: string }> }>(
        '/pricing/preview',
        body,
      ),
  });
}
