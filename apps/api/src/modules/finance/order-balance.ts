import { calculateOrderBalance, creditBalance } from '@bms/calc';
import type { ScopedTransaction } from '../../common/prisma/prisma.service';

/** Takes the row lock that serialises everything which changes one order's money. */
export async function lockOrder(tx: ScopedTransaction, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
}

/** The same for a customer's credit, so two payments cannot spend one credit twice. */
export async function lockCustomer(tx: ScopedTransaction, customerId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} FOR UPDATE`;
}

/**
 * Recomputes the order's paid, refunded and balance figures and its payment status from its
 * payments, in the caller's transaction (design.md D7). Call it, after taking `lockOrder`, in every
 * transaction that adds or changes a payment of the order.
 */
export async function recalculateOrder(tx: ScopedTransaction, orderId: string) {
  const [order, payments] = await Promise.all([
    tx.order.findFirstOrThrow({ where: { id: orderId } }),
    tx.payment.findMany({
      where: { orderId },
      select: { type: true, status: true, amount: true },
    }),
  ]);
  const result = calculateOrderBalance({
    totalAmount: order.totalAmount.toFixed(),
    returnedAmount: order.returnedAmount.toFixed(),
    depositRequired: order.depositRequired.toFixed(),
    payments: payments.map((p) => ({ type: p.type, status: p.status, amount: p.amount.toFixed() })),
  });
  const updated = await tx.order.update({
    where: { id: orderId },
    data: {
      paidAmount: result.paidAmount,
      refundedAmount: result.refundedAmount,
      balanceDue: result.balanceDue,
      paymentStatus: result.paymentStatus,
    },
  });
  return { order: updated, result };
}

export async function customerCredit(tx: ScopedTransaction, customerId: string): Promise<string> {
  const rows = await tx.customerCredit.findMany({
    where: { customerId },
    select: { amount: true },
  });
  return creditBalance(rows.map((r) => ({ amount: r.amount.toFixed() })));
}
