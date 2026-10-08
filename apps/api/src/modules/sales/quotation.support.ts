import type { Quotation, QuotationItem } from '@prisma/client';

export interface LineDto {
  id: string;
  lineNo: number;
  kind: string;
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
  fieldSnapshot: unknown;
}

export interface QuotationDto {
  id: string;
  quotationNumber: string;
  customerId: string | null;
  leadId: string | null;
  status: string;
  validUntil: string | null;
  subtotal: string;
  discountType: string | null;
  discountValue: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  notes: string | null;
  terms: string | null;
  source: string | null;
  channel: string | null;
  campaign: string | null;
  assignedToId: string | null;
  sentAt: string | null;
  sentVia: string | null;
  acceptedAt: string | null;
  acceptedVia: string | null;
  acceptanceRecordedById: string | null;
  acceptanceFileId: string | null;
  rejectedReason: string | null;
  customFields: Record<string, unknown>;
  version: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  items?: LineDto[];
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const toLineDto = (i: QuotationItem): LineDto => ({
  id: i.id,
  lineNo: i.lineNo,
  kind: i.kind,
  productId: i.productId,
  variantId: i.variantId,
  name: i.name,
  sku: i.sku,
  description: i.description,
  quantity: i.quantity.toFixed(),
  unitId: i.unitId,
  listPrice: i.listPrice.toFixed(),
  unitPrice: i.unitPrice.toFixed(),
  discountType: i.discountType,
  discountValue: i.discountValue.toFixed(),
  discountAmount: i.discountAmount.toFixed(),
  taxClassId: i.taxClassId,
  taxRate: i.taxRate.toFixed(),
  taxAmount: i.taxAmount.toFixed(),
  lineTotal: i.lineTotal.toFixed(),
  customFields: i.customFields as Record<string, unknown>,
  fieldSnapshot: i.fieldSnapshot,
});

export const toQuotationDto = (q: Quotation, items?: QuotationItem[]): QuotationDto => ({
  id: q.id,
  quotationNumber: q.quotationNumber,
  customerId: q.customerId,
  leadId: q.leadId,
  status: q.status,
  validUntil: iso(q.validUntil),
  subtotal: q.subtotal.toFixed(),
  discountType: q.discountType,
  discountValue: q.discountValue.toFixed(),
  discountAmount: q.discountAmount.toFixed(),
  taxAmount: q.taxAmount.toFixed(),
  totalAmount: q.totalAmount.toFixed(),
  notes: q.notes,
  terms: q.terms,
  source: q.source,
  channel: q.channel,
  campaign: q.campaign,
  assignedToId: q.assignedToId,
  sentAt: iso(q.sentAt),
  sentVia: q.sentVia,
  acceptedAt: iso(q.acceptedAt),
  acceptedVia: q.acceptedVia,
  acceptanceRecordedById: q.acceptanceRecordedById,
  acceptanceFileId: q.acceptanceFileId,
  rejectedReason: q.rejectedReason,
  customFields: q.customFields as Record<string, unknown>,
  version: q.version,
  createdById: q.createdById,
  createdAt: q.createdAt.toISOString(),
  updatedAt: q.updatedAt.toISOString(),
  ...(items ? { items: [...items].sort((a, b) => a.lineNo - b.lineNo).map(toLineDto) } : {}),
});
