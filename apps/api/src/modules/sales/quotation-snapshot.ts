import type { Customer, Lead, Quotation, QuotationItem } from '@prisma/client';
import { toLineDto } from './quotation.support';

/** Everything the quotation PDF needs, frozen at the moment it is sent (design.md Documents). */
export interface QuotationSnapshot {
  type: 'QUOTATION';
  number: string;
  issuedAt: string;
  validUntil: string | null;
  business: {
    legalName: string;
    phone?: string;
    email?: string;
    address?: string;
    taxNumber?: string;
    logoFileId?: string;
  };
  customer: { name: string; phone: string | null; email: string | null; address: unknown } | null;
  contact: { name: string; phone: string | null; email: string | null } | null;
  currency: { code: string; decimals: number };
  pricesIncludeTax: boolean;
  lines: ReturnType<typeof toLineDto>[];
  totals: { subtotal: string; discountAmount: string; taxAmount: string; totalAmount: string };
  discount: { type: string | null; value: string };
  notes: string | null;
  terms: string | null;
  bankDetails: unknown;
}

export interface SnapshotSettings {
  business: QuotationSnapshot['business'];
  branding: { logoFileId?: string };
  locale: { currency: string; currencyDecimals: number };
  pricesIncludeTax: boolean;
  defaultTerms?: string;
}

export function buildQuotationSnapshot(input: {
  quotation: Quotation;
  items: QuotationItem[];
  customer: Customer | null;
  lead: Lead | null;
  settings: SnapshotSettings;
  at: Date;
}): QuotationSnapshot {
  const { quotation, items, customer, lead, settings } = input;
  return {
    type: 'QUOTATION',
    number: quotation.quotationNumber,
    issuedAt: input.at.toISOString(),
    validUntil: quotation.validUntil ? quotation.validUntil.toISOString() : null,
    business: { ...settings.business, logoFileId: settings.branding.logoFileId },
    customer: customer
      ? {
          name: customer.fullName,
          phone: customer.phones[0] ?? null,
          email: customer.email,
          address: customer.billingAddress,
        }
      : null,
    contact: lead ? { name: lead.fullName, phone: lead.phone, email: lead.email } : null,
    currency: { code: settings.locale.currency, decimals: settings.locale.currencyDecimals },
    pricesIncludeTax: settings.pricesIncludeTax,
    lines: [...items].sort((a, b) => a.lineNo - b.lineNo).map(toLineDto),
    totals: {
      subtotal: quotation.subtotal.toFixed(),
      discountAmount: quotation.discountAmount.toFixed(),
      taxAmount: quotation.taxAmount.toFixed(),
      totalAmount: quotation.totalAmount.toFixed(),
    },
    discount: { type: quotation.discountType, value: quotation.discountValue.toFixed() },
    notes: quotation.notes,
    terms: quotation.terms ?? settings.defaultTerms ?? null,
    bankDetails: null,
  };
}
