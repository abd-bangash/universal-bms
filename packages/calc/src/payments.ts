import Decimal from 'decimal.js';

const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type PaymentKind = 'ORDER_PAYMENT' | 'DEPOSIT' | 'ADVANCE' | 'CREDIT_APPLIED' | 'REFUND';
export type PaymentState = 'PENDING_VERIFICATION' | 'CONFIRMED' | 'REJECTED' | 'VOIDED';
export type OrderPaymentState =
  'UNPAID' | 'DEPOSIT_PAID' | 'PARTIALLY_PAID' | 'PAID' | 'OVERPAID' | 'REFUNDED';

export interface BalancePayment {
  type: PaymentKind;
  status: PaymentState;
  /** Always positive; the direction is given by the type. */
  amount: string;
}

export interface BalanceInput {
  totalAmount: string;
  returnedAmount: string;
  depositRequired: string;
  payments: readonly BalancePayment[];
}

export interface BalanceResult {
  paidAmount: string;
  refundedAmount: string;
  netTotal: string;
  balanceDue: string;
  paymentStatus: OrderPaymentState;
}

/** Payments of these types, once confirmed, count towards what the customer has paid for the order. */
const COUNTS_AS_PAID: ReadonlySet<PaymentKind> = new Set([
  'ORDER_PAYMENT',
  'DEPOSIT',
  'CREDIT_APPLIED',
]);

/**
 * The order's balance from its payments (design.md, Payments and Finance). Only CONFIRMED payments
 * count; an ADVANCE belongs to the customer's credit, not to an order.
 *
 *   paidAmount     = Σ CONFIRMED ORDER_PAYMENT, DEPOSIT, CREDIT_APPLIED
 *   refundedAmount = Σ CONFIRMED REFUND
 *   balanceDue     = (totalAmount − returnedAmount) − (paidAmount − refundedAmount)
 *
 * The status is the first rule that matches, with netPaid = paidAmount − refundedAmount.
 */
export function calculateOrderBalance(input: BalanceInput): BalanceResult {
  let paid = new Dec(0);
  let refunded = new Dec(0);
  for (const p of input.payments) {
    if (p.status !== 'CONFIRMED') continue;
    if (COUNTS_AS_PAID.has(p.type)) paid = paid.plus(p.amount);
    else if (p.type === 'REFUND') refunded = refunded.plus(p.amount);
  }
  const netTotal = new Dec(input.totalAmount).minus(input.returnedAmount);
  const netPaid = paid.minus(refunded);
  const balance = netTotal.minus(netPaid);
  const deposit = new Dec(input.depositRequired);

  let paymentStatus: OrderPaymentState;
  if (refunded.gt(0) && netPaid.isZero()) paymentStatus = 'REFUNDED';
  else if (netPaid.isZero()) paymentStatus = 'UNPAID';
  else if (balance.isNegative()) paymentStatus = 'OVERPAID';
  else if (balance.isZero()) paymentStatus = 'PAID';
  else if (deposit.gt(0) && netPaid.gte(deposit)) paymentStatus = 'DEPOSIT_PAID';
  else paymentStatus = 'PARTIALLY_PAID';

  return {
    paidAmount: paid.toFixed(),
    refundedAmount: refunded.toFixed(),
    netTotal: netTotal.toFixed(),
    balanceDue: balance.toFixed(),
    paymentStatus,
  };
}

/** A customer's credit balance: the sum of the signed ledger rows. */
export function creditBalance(rows: ReadonlyArray<{ amount: string }>): string {
  return rows.reduce((sum, r) => sum.plus(r.amount), new Dec(0)).toFixed();
}
