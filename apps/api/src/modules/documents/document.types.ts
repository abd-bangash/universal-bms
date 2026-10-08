import type { LineDto } from '../sales/quotation.support';

export const DOCUMENT_KINDS = [
  'QUOTATION',
  'ORDER_CONFIRMATION',
  'INVOICE',
  'PURCHASE_ORDER',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface DocumentParty {
  name: string;
  phone: string | null;
  email: string | null;
  address: unknown;
}

export interface TaxBreakdownRow {
  rate: string;
  taxable: string;
  tax: string;
}

export interface DocumentPayment {
  date: string;
  method: string;
  amount: string;
  reference?: string | null;
}

/**
 * Everything a document needs, frozen when it is issued (design.md, Documents). Optional parts
 * are absent from snapshots stored before they existed; the layout treats them as empty.
 */
export interface DocumentSnapshot {
  type: DocumentKind;
  number: string;
  issuedAt: string;
  validUntil?: string | null;
  /** Purchase orders: when the goods are expected. */
  expectedDate?: string | null;
  business: {
    legalName: string;
    phone?: string;
    email?: string;
    address?: string;
    taxNumber?: string;
    logoFileId?: string;
  };
  customer: DocumentParty | null;
  /** A lead the quotation is addressed to before it becomes a customer. */
  contact?: { name: string; phone: string | null; email: string | null } | null;
  currency: { code: string; decimals: number };
  locale?: { language: string; dateFormat: string; timezone: string };
  /** The words the workspace uses for the document and the person it is for (Requirement 29.7). */
  labels?: { document: string; customer: string };
  pricesIncludeTax: boolean;
  lines: LineDto[];
  totals: {
    subtotal: string;
    discountAmount: string;
    taxAmount: string;
    roundingAmount?: string;
    totalAmount: string;
  };
  discount: { type: string | null; value: string };
  taxBreakdown?: TaxBreakdownRow[];
  payments?: DocumentPayment[];
  paidAmount?: string;
  balanceDue?: string;
  notes: string | null;
  terms: string | null;
  bankDetails: unknown;
  /** The order a document belongs to, shown on invoices. */
  orderNumber?: string;
}

/** Things a renderer needs that are not part of the frozen data. */
export interface RenderOptions {
  logo?: Buffer | null;
  paper?: 'A4';
}

export type ReceiptPaper = '58mm' | '80mm' | 'A4';
export const RECEIPT_PAPERS: readonly ReceiptPaper[] = ['58mm', '80mm', 'A4'];

/** What a sale receipt stores in `Receipt.data` (Requirement 12.5): everything needed to draw it again. */
export interface ReceiptData {
  business: DocumentSnapshot['business'];
  currency: { code: string; decimals: number };
  locale?: { language: string; dateFormat: string; timezone: string };
  transactionNumber: string;
  issuedAt: string;
  cashier: string | null;
  salesperson?: string | null;
  customer: { id?: string; name: string } | null;
  lines: LineDto[];
  totals: DocumentSnapshot['totals'];
  discount: { type: string | null; value: string };
  taxBreakdown?: TaxBreakdownRow[];
  payments: Array<{ method: string; amount: string; reference?: string | null }>;
  tendered?: string;
  changeDue?: string;
  footer: string | null;
}

export interface ReceiptRenderOptions {
  logo?: Buffer | null;
  paper: ReceiptPaper;
  receiptNumber: string;
  /** Copies printed after the first one carry a REPRINT mark (Requirement 29.8). */
  reprint?: boolean;
}
