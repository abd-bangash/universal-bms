import { D } from '../../common/money';
import { ExpensesService } from '../../modules/finance/expenses.service';
import { PaymentsService } from '../../modules/finance/payments.service';
import type { DemoContext, DemoStep, StepResult } from '../demo-seed';

/** How much of the order each demo order has paid: "deposit", a fraction of the total, or everything. */
const ORDER_PAYMENTS: Record<
  string,
  { how: 'deposit' | 'half' | 'partial' | 'full' | 'pending'; method: string }
> = {
  'demo-seed-o5': { how: 'deposit', method: 'Cash' },
  'demo-seed-o6': { how: 'pending', method: 'Bank transfer' },
  'demo-seed-o7': { how: 'deposit', method: 'Bank transfer' },
  'demo-seed-o8': { how: 'deposit', method: 'Cash' },
  'demo-seed-o9': { how: 'partial', method: 'Mobile money' },
  'demo-seed-o10': { how: 'full', method: 'Cash' },
  'demo-seed-o11': { how: 'half', method: 'Card' },
  'demo-seed-o12': { how: 'full', method: 'Bank transfer' },
  'demo-seed-o13': { how: 'full', method: 'Cash' },
};

const EXPENSES: ReadonlyArray<{
  tag: string;
  category: string;
  amount: string;
  daysAgo: number;
  method: string;
  description: string;
}> = [
  {
    tag: 'e1',
    category: 'Rent',
    amount: '120000',
    daysAgo: 35,
    method: 'Bank transfer',
    description: 'Showroom rent, last month',
  },
  {
    tag: 'e2',
    category: 'Rent',
    amount: '120000',
    daysAgo: 5,
    method: 'Bank transfer',
    description: 'Showroom rent, this month',
  },
  {
    tag: 'e3',
    category: 'Raw materials',
    amount: '285000',
    daysAgo: 28,
    method: 'Bank transfer',
    description: 'Sheesham timber, 3 cubic metres',
  },
  {
    tag: 'e4',
    category: 'Raw materials',
    amount: '64000',
    daysAgo: 12,
    method: 'Cash',
    description: 'Upholstery fabric and foam',
  },
  {
    tag: 'e5',
    category: 'Workshop wages',
    amount: '210000',
    daysAgo: 8,
    method: 'Cash',
    description: 'Workshop wages, fortnight',
  },
  {
    tag: 'e6',
    category: 'Utilities',
    amount: '38500',
    daysAgo: 20,
    method: 'Mobile money',
    description: 'Electricity and gas',
  },
  {
    tag: 'e7',
    category: 'Transport and delivery',
    amount: '15000',
    daysAgo: 6,
    method: 'Cash',
    description: 'Delivery van fuel',
  },
  {
    tag: 'e8',
    category: 'Marketing',
    amount: '45000',
    daysAgo: 15,
    method: 'Card',
    description: 'Instagram advertising',
  },
  {
    tag: 'e9',
    category: 'Office supplies',
    amount: '6200',
    daysAgo: 3,
    method: 'Cash',
    description: 'Printer paper and ink',
  },
  {
    tag: 'e10',
    category: 'Equipment maintenance',
    amount: '18500',
    daysAgo: 2,
    method: 'Cash',
    description: 'Saw blades and sharpening',
  },
];

const isoDaysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/**
 * Payments on the demo orders (a deposit here, a half payment there, one waiting for confirmation,
 * one that was voided), an advance that became customer credit, and ten expenses. All through the
 * real services, so balances, receipts and the audit trail are genuine.
 */
export const financeStep: DemoStep = {
  name: 'finance',
  async run(ctx: DemoContext): Promise<StepResult> {
    const { unscoped } = ctx.prisma;
    const payments = ctx.get(PaymentsService);
    const expenses = ctx.get(ExpensesService);

    const methodIds = new Map(
      (await unscoped.paymentMethod.findMany({ where: { workspaceId: ctx.workspaceId } })).map(
        (m) => [m.name, m.id],
      ),
    );
    const categoryIds = new Map(
      (await unscoped.expenseCategory.findMany({ where: { workspaceId: ctx.workspaceId } })).map(
        (c) => [c.name, c.id],
      ),
    );
    const done = new Set(
      (
        await unscoped.payment.findMany({
          where: { workspaceId: ctx.workspaceId, note: { startsWith: 'demo-seed-' } },
          select: { note: true },
        })
      ).map((p) => p.note),
    );
    const haveExpense = new Set(
      (
        await unscoped.expense.findMany({
          where: { workspaceId: ctx.workspaceId },
          select: { description: true },
        })
      ).map((e) => e.description),
    );
    let created = 0;
    let existing = 0;

    for (const [campaign, plan] of Object.entries(ORDER_PAYMENTS)) {
      const note = `demo-seed-pay-${campaign.replace('demo-seed-', '')}`;
      if (done.has(note)) {
        existing += 1;
        continue;
      }
      const order = await unscoped.order.findFirst({
        where: { workspaceId: ctx.workspaceId, campaign },
      });
      const method = methodIds.get(plan.method);
      if (!order || !method) continue;
      const total = D(order.totalAmount.toFixed());
      const amount =
        plan.how === 'full'
          ? total
          : plan.how === 'half'
            ? total.div(2).toDecimalPlaces(2)
            : plan.how === 'pending' || plan.how === 'partial'
              ? total.mul('0.3').toDecimalPlaces(2)
              : D(order.depositRequired.toFixed()).gt(0)
                ? D(order.depositRequired.toFixed())
                : total.mul('0.3').toDecimalPlaces(2);
      await ctx.asOwner(async (owner) => {
        // the Salesperson cannot confirm payments, so theirs waits for the Account Staff
        const user =
          plan.how === 'pending'
            ? { ...owner, permissions: owner.permissions.filter((p) => p !== 'payment:confirm') }
            : owner;
        await payments.record(user, {
          type: plan.how === 'full' ? 'ORDER_PAYMENT' : 'DEPOSIT',
          orderId: order.id,
          paymentMethodId: method,
          amount: amount.toFixed(),
          referenceNumber:
            plan.method === 'Cash' || plan.method === 'Card'
              ? undefined
              : `DEMO-${campaign.slice(-2).toUpperCase()}${order.orderNumber.slice(-4)}`,
          note,
        });
      });
      created += 1;
    }

    // an advance from a customer, which becomes credit; and a payment entered twice and voided
    const advanceNote = 'demo-seed-pay-advance';
    if (done.has(advanceNote)) existing += 1;
    else {
      const customer = await unscoped.customer.findFirst({
        where: { workspaceId: ctx.workspaceId, isWalkIn: false },
        orderBy: { fullName: 'asc' },
      });
      const cash = methodIds.get('Cash');
      if (customer && cash) {
        await ctx.asOwner((owner) =>
          payments.record(owner, {
            type: 'ADVANCE',
            customerId: customer.id,
            paymentMethodId: cash,
            amount: '25000',
            note: advanceNote,
          }),
        );
        created += 1;
      }
    }
    const voidNote = 'demo-seed-pay-voided';
    if (done.has(voidNote)) existing += 1;
    else {
      const order = await unscoped.order.findFirst({
        where: { workspaceId: ctx.workspaceId, campaign: 'demo-seed-o4' },
      });
      const cash = methodIds.get('Cash');
      if (order && cash) {
        await ctx.asOwner(async (owner) => {
          const p = await payments.record(owner, {
            type: 'DEPOSIT',
            orderId: order.id,
            paymentMethodId: cash,
            amount: '1000',
            note: voidNote,
          });
          await payments.void(owner, p.id, 'Entered twice by mistake');
        });
        created += 1;
      }
    }

    for (const item of EXPENSES) {
      if (haveExpense.has(item.description)) {
        existing += 1;
        continue;
      }
      const categoryId = categoryIds.get(item.category);
      const paymentMethodId = methodIds.get(item.method);
      if (!categoryId || !paymentMethodId) continue;
      await ctx.asOwner((owner) =>
        expenses.create(owner, {
          categoryId,
          paymentMethodId,
          amount: item.amount,
          expenseDate: isoDaysAgo(item.daysAgo),
          description: item.description,
        }),
      );
      created += 1;
    }
    return { created, existing };
  },
};
