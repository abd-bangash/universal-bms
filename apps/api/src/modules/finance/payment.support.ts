import type { CustomerCredit, Payment, Receipt } from '@prisma/client';

export interface PaymentDto {
  id: string;
  paymentNumber: string;
  type: string;
  status: string;
  orderId: string | null;
  customerId: string | null;
  paymentMethodId: string | null;
  accountId: string | null;
  amount: string;
  paidAt: string;
  referenceNumber: string | null;
  proofFileId: string | null;
  note: string | null;
  recordedById: string | null;
  confirmedById: string | null;
  confirmedAt: string | null;
  rejectedReason: string | null;
  voidedById: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const toPaymentDto = (p: Payment): PaymentDto => ({
  id: p.id,
  paymentNumber: p.paymentNumber,
  type: p.type,
  status: p.status,
  orderId: p.orderId,
  customerId: p.customerId,
  paymentMethodId: p.paymentMethodId,
  accountId: p.accountId,
  amount: p.amount.toFixed(),
  paidAt: p.paidAt.toISOString(),
  referenceNumber: p.referenceNumber,
  proofFileId: p.proofFileId,
  note: p.note,
  recordedById: p.recordedById,
  confirmedById: p.confirmedById,
  confirmedAt: iso(p.confirmedAt),
  rejectedReason: p.rejectedReason,
  voidedById: p.voidedById,
  voidedAt: iso(p.voidedAt),
  voidReason: p.voidReason,
  createdAt: p.createdAt.toISOString(),
});

export interface CreditEntryDto {
  id: string;
  amount: string;
  reason: string;
  paymentId: string | null;
  orderId: string | null;
  createdAt: string;
}

export const toCreditDto = (c: CustomerCredit): CreditEntryDto => ({
  id: c.id,
  amount: c.amount.toFixed(),
  reason: c.reason,
  paymentId: c.paymentId,
  orderId: c.orderId,
  createdAt: c.createdAt.toISOString(),
});

export interface ReceiptDto {
  id: string;
  receiptNumber: string;
  orderId: string | null;
  paymentId: string | null;
  type: string;
  issuedAt: string;
  reprintCount: number;
  data: unknown;
}

export const toReceiptDto = (r: Receipt): ReceiptDto => ({
  id: r.id,
  receiptNumber: r.receiptNumber,
  orderId: r.orderId,
  paymentId: r.paymentId,
  type: r.type,
  issuedAt: r.issuedAt.toISOString(),
  reprintCount: r.reprintCount,
  data: r.data,
});
