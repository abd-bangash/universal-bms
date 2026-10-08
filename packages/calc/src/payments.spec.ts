import fc from 'fast-check';
import Decimal from 'decimal.js';
import {
  calculateOrderBalance,
  creditBalance,
  type BalancePayment,
  type PaymentKind,
  type PaymentState,
} from './payments';

const base = {
  totalAmount: '1000',
  returnedAmount: '0',
  depositRequired: '300',
};
const pay = (
  type: PaymentKind,
  amount: string,
  status: PaymentState = 'CONFIRMED',
): BalancePayment => ({ type, amount, status });

describe('calculateOrderBalance', () => {
  it('an order with no payments is unpaid and owes the total', () => {
    expect(calculateOrderBalance({ ...base, payments: [] })).toEqual({
      paidAmount: '0',
      refundedAmount: '0',
      netTotal: '1000',
      balanceDue: '1000',
      paymentStatus: 'UNPAID',
    });
  });

  it('walks through the statuses as money arrives', () => {
    const status = (payments: BalancePayment[]) =>
      calculateOrderBalance({ ...base, payments }).paymentStatus;
    expect(status([pay('DEPOSIT', '100')])).toBe('PARTIALLY_PAID');
    expect(status([pay('DEPOSIT', '300')])).toBe('DEPOSIT_PAID');
    expect(status([pay('DEPOSIT', '300'), pay('ORDER_PAYMENT', '699.99')])).toBe('DEPOSIT_PAID');
    expect(status([pay('DEPOSIT', '300'), pay('ORDER_PAYMENT', '700')])).toBe('PAID');
    expect(status([pay('ORDER_PAYMENT', '1200')])).toBe('OVERPAID');
  });

  it('without a required deposit a partial payment is just partial', () => {
    const r = calculateOrderBalance({
      ...base,
      depositRequired: '0',
      payments: [pay('ORDER_PAYMENT', '500')],
    });
    expect(r.paymentStatus).toBe('PARTIALLY_PAID');
    expect(r.balanceDue).toBe('500');
  });

  it('only confirmed payments count', () => {
    for (const status of ['PENDING_VERIFICATION', 'REJECTED', 'VOIDED'] as const) {
      expect(
        calculateOrderBalance({ ...base, payments: [pay('DEPOSIT', '300', status)] }),
      ).toMatchObject({ paidAmount: '0', balanceDue: '1000', paymentStatus: 'UNPAID' });
    }
  });

  it('applied credit counts as paid; an advance does not belong to the order', () => {
    expect(
      calculateOrderBalance({ ...base, payments: [pay('CREDIT_APPLIED', '400')] }),
    ).toMatchObject({ paidAmount: '400', balanceDue: '600' });
    expect(calculateOrderBalance({ ...base, payments: [pay('ADVANCE', '400')] })).toMatchObject({
      paidAmount: '0',
      balanceDue: '1000',
    });
  });

  it('refunds reduce what was paid, and a fully refunded order shows as refunded', () => {
    expect(
      calculateOrderBalance({
        ...base,
        payments: [pay('ORDER_PAYMENT', '1000'), pay('REFUND', '250')],
      }),
    ).toMatchObject({ paidAmount: '1000', refundedAmount: '250', balanceDue: '250' });
    expect(
      calculateOrderBalance({
        ...base,
        payments: [pay('ORDER_PAYMENT', '1000'), pay('REFUND', '1000')],
      }).paymentStatus,
    ).toBe('REFUNDED');
  });

  it('returned goods reduce what is owed', () => {
    expect(
      calculateOrderBalance({
        ...base,
        returnedAmount: '200',
        payments: [pay('ORDER_PAYMENT', '800')],
      }),
    ).toMatchObject({ netTotal: '800', balanceDue: '0', paymentStatus: 'PAID' });
  });

  it('keeps decimals exact', () => {
    expect(
      calculateOrderBalance({
        totalAmount: '0.3',
        returnedAmount: '0',
        depositRequired: '0',
        payments: [pay('ORDER_PAYMENT', '0.1'), pay('ORDER_PAYMENT', '0.2')],
      }),
    ).toMatchObject({ balanceDue: '0', paymentStatus: 'PAID' });
  });
});

describe('creditBalance', () => {
  it('sums the signed rows', () => {
    expect(creditBalance([{ amount: '500' }, { amount: '-120.5' }, { amount: '0.5' }])).toBe('380');
    expect(creditBalance([])).toBe('0');
  });
});

describe('calculateOrderBalance — properties', () => {
  const amount = fc
    .integer({ min: 1, max: 5_000_000 })
    .map((cents) => new Decimal(cents).div(100).toFixed(2));
  const payment = fc.record({
    type: fc.constantFrom<PaymentKind>(
      'ORDER_PAYMENT',
      'DEPOSIT',
      'ADVANCE',
      'CREDIT_APPLIED',
      'REFUND',
    ),
    status: fc.constantFrom<PaymentState>(
      'PENDING_VERIFICATION',
      'CONFIRMED',
      'REJECTED',
      'VOIDED',
    ),
    amount,
  });

  it('balanceDue always equals netTotal − (confirmed paid − confirmed refunded)', () => {
    fc.assert(
      fc.property(
        amount,
        amount,
        fc.array(payment, { maxLength: 30 }),
        (total, deposit, payments) => {
          const r = calculateOrderBalance({
            totalAmount: total,
            returnedAmount: '0',
            depositRequired: deposit,
            payments,
          });
          const confirmed = payments.filter((p) => p.status === 'CONFIRMED');
          const sum = (types: PaymentKind[]) =>
            confirmed
              .filter((p) => types.includes(p.type))
              .reduce((a, p) => a.plus(p.amount), new Decimal(0));
          const expected = new Decimal(total)
            .minus(sum(['ORDER_PAYMENT', 'DEPOSIT', 'CREDIT_APPLIED']).minus(sum(['REFUND'])))
            .toFixed();
          expect(r.balanceDue).toBe(expected);
        },
      ),
    );
  });

  it('payments that are not confirmed never change the result', () => {
    fc.assert(
      fc.property(
        amount,
        fc.array(payment, { maxLength: 20 }),
        fc.array(payment, { maxLength: 20 }),
        (total, payments, extra) => {
          const unconfirmed = extra.map((p) => ({
            ...p,
            status: 'PENDING_VERIFICATION' as const,
          }));
          const input = { totalAmount: total, returnedAmount: '0', depositRequired: '0' };
          expect(
            calculateOrderBalance({ ...input, payments: [...payments, ...unconfirmed] }),
          ).toEqual(calculateOrderBalance({ ...input, payments }));
        },
      ),
    );
  });
});
