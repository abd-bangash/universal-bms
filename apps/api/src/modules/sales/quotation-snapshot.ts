import type { Customer, Lead, Quotation, QuotationItem } from '@prisma/client';
import type { DocumentSnapshot } from '../documents/document.types';
import { settingsPart, taxBreakdown } from '../documents/snapshot.builders';
import type { SnapshotSettings } from '../documents/snapshot-settings';
import { toLineDto } from './quotation.support';

export type QuotationSnapshot = DocumentSnapshot & { type: 'QUOTATION' };

/** Everything the quotation PDF needs, frozen at the moment it is sent (design.md Documents). */
export function buildQuotationSnapshot(input: {
  quotation: Quotation;
  items: QuotationItem[];
  customer: Customer | null;
  lead: Lead | null;
  settings: SnapshotSettings;
  at: Date;
}): QuotationSnapshot {
  const { quotation, items, customer, lead, settings } = input;
  const lines = [...items].sort((a, b) => a.lineNo - b.lineNo).map(toLineDto);
  return {
    type: 'QUOTATION',
    number: quotation.quotationNumber,
    issuedAt: input.at.toISOString(),
    validUntil: quotation.validUntil ? quotation.validUntil.toISOString() : null,
    ...settingsPart(settings, 'QUOTATION'),
    customer: customer
      ? {
          name: customer.fullName,
          phone: customer.phones[0] ?? null,
          email: customer.email,
          address: customer.billingAddress,
        }
      : null,
    contact: lead ? { name: lead.fullName, phone: lead.phone, email: lead.email } : null,
    lines,
    totals: {
      subtotal: quotation.subtotal.toFixed(),
      discountAmount: quotation.discountAmount.toFixed(),
      taxAmount: quotation.taxAmount.toFixed(),
      totalAmount: quotation.totalAmount.toFixed(),
    },
    discount: { type: quotation.discountType, value: quotation.discountValue.toFixed() },
    taxBreakdown: taxBreakdown(lines),
    notes: quotation.notes,
    terms: quotation.terms ?? settings.quotationTerms ?? null,
    bankDetails: settings.showBankDetails ? settings.bankDetails : null,
  };
}
