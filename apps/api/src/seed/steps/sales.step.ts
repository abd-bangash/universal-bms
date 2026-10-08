import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { OrdersService } from '../../modules/sales/orders.service';
import { QuotationsService } from '../../modules/sales/quotations.service';
import type { DemoContext, DemoStep, StepResult } from '../demo-seed';
import { DEMO_CUSTOMERS } from './crm.data';

type DemoLine =
  | { variant: number; quantity: string }
  | { custom: string; price: string; fields: Record<string, unknown> };

interface DemoQuotation {
  tag: string;
  customer: number;
  lines: DemoLine[];
  /** Where the quotation ends up. */
  end: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted';
}

interface DemoOrder {
  tag: string;
  customer: number;
  lines: DemoLine[];
  /** The path the order has taken, ending at its current status. */
  path: string[];
  cancelReason?: string;
}

const sofa = (fabric: string): DemoLine => ({
  custom: 'Custom corner sofa',
  price: '165000',
  fields: {
    size_type: 'custom',
    length: { value: '9', unit: 'ft' },
    width: { value: '6', unit: 'ft' },
    material: 'fabric',
    fabric,
    color: 'Grey',
    customization_notes: 'Washable covers, deep seat',
    estimated_production_days: 28,
  },
});

const WHOLE_PATH = [
  'confirmed',
  'in_production',
  'ready',
  'out_for_delivery',
  'delivered',
  'completed',
];
const upTo = (status: string) => WHOLE_PATH.slice(0, WHOLE_PATH.indexOf(status) + 1);

export const DEMO_QUOTATIONS: readonly DemoQuotation[] = [
  { tag: 'q1', customer: 0, lines: [{ variant: 0, quantity: '1' }], end: 'draft' },
  {
    tag: 'q2',
    customer: 1,
    lines: [
      { variant: 1, quantity: '2' },
      { variant: 2, quantity: '1' },
    ],
    end: 'draft',
  },
  { tag: 'q3', customer: 2, lines: [sofa('Velvet')], end: 'draft' },
  { tag: 'q4', customer: 3, lines: [{ variant: 3, quantity: '1' }], end: 'sent' },
  { tag: 'q5', customer: 4, lines: [sofa('Linen'), { variant: 4, quantity: '2' }], end: 'sent' },
  { tag: 'q6', customer: 5, lines: [{ variant: 5, quantity: '4' }], end: 'rejected' },
  { tag: 'q7', customer: 6, lines: [{ variant: 6, quantity: '1' }], end: 'expired' },
  {
    tag: 'q8',
    customer: 7,
    lines: [
      { variant: 7, quantity: '1' },
      { variant: 8, quantity: '1' },
    ],
    end: 'accepted',
  },
  { tag: 'q9', customer: 8, lines: [sofa('Leatherette')], end: 'converted' },
  { tag: 'q10', customer: 9, lines: [{ variant: 9, quantity: '2' }], end: 'converted' },
];

export const DEMO_ORDERS: readonly DemoOrder[] = [
  { tag: 'o1', customer: 10, lines: [{ variant: 10, quantity: '1' }], path: [] },
  { tag: 'o2', customer: 11, lines: [{ variant: 11, quantity: '2' }], path: [] },
  { tag: 'o3', customer: 12, lines: [sofa('Velvet')], path: [] },
  { tag: 'o4', customer: 13, lines: [{ variant: 12, quantity: '1' }], path: upTo('confirmed') },
  { tag: 'o5', customer: 14, lines: [{ variant: 13, quantity: '3' }], path: upTo('confirmed') },
  { tag: 'o6', customer: 15, lines: [sofa('Linen')], path: upTo('confirmed') },
  {
    tag: 'o7',
    customer: 16,
    lines: [sofa('Velvet'), { variant: 14, quantity: '1' }],
    path: upTo('in_production'),
  },
  { tag: 'o8', customer: 17, lines: [{ variant: 15, quantity: '1' }], path: upTo('in_production') },
  { tag: 'o9', customer: 18, lines: [{ variant: 16, quantity: '2' }], path: upTo('ready') },
  { tag: 'o10', customer: 19, lines: [{ variant: 17, quantity: '1' }], path: upTo('delivered') },
  { tag: 'o11', customer: 0, lines: [{ variant: 18, quantity: '1' }], path: upTo('delivered') },
  { tag: 'o12', customer: 1, lines: [{ variant: 19, quantity: '2' }], path: upTo('completed') },
  { tag: 'o13', customer: 2, lines: [sofa('Leatherette')], path: upTo('completed') },
  {
    tag: 'o14',
    customer: 3,
    lines: [{ variant: 20, quantity: '1' }],
    path: ['confirmed', 'on_hold'],
  },
  {
    tag: 'o15',
    customer: 4,
    lines: [{ variant: 21, quantity: '1' }],
    path: ['confirmed', 'cancelled'],
    cancelReason: 'Customer changed their mind',
  },
];

/**
 * 10 quotations and 15 orders across every status, for demo customers. Everything goes through the
 * real services so numbers, history, timelines and audit events are genuine. Each record carries a
 * `demo-seed` tag in its campaign field, which is how a second run knows what already exists.
 */
export const salesStep: DemoStep = {
  name: 'sales',
  async run(ctx: DemoContext): Promise<StepResult> {
    const { unscoped } = ctx.prisma;
    const quotations = ctx.get(QuotationsService);
    const orders = ctx.get(OrdersService);

    const customers = new Map(
      (
        await unscoped.customer.findMany({
          where: { workspaceId: ctx.workspaceId, isWalkIn: false },
          select: { id: true, fullName: true },
        })
      ).map((c) => [c.fullName, c.id]),
    );
    const variants = (
      await unscoped.productVariant.findMany({
        where: { workspaceId: ctx.workspaceId, status: 'ACTIVE', isDefault: true },
        orderBy: { sku: 'asc' },
        select: { id: true },
      })
    ).map((v) => v.id);
    if (variants.length === 0 || customers.size === 0) return { created: 0, existing: 0 };

    const tagOf = (tag: string) => `demo-seed-${tag}`;
    const haveQuotation = new Set(
      (
        await unscoped.quotation.findMany({
          where: { workspaceId: ctx.workspaceId, campaign: { startsWith: 'demo-seed-' } },
          select: { campaign: true },
        })
      ).map((q) => q.campaign),
    );
    const haveOrder = new Set(
      (
        await unscoped.order.findMany({
          where: { workspaceId: ctx.workspaceId, campaign: { startsWith: 'demo-seed-' } },
          select: { campaign: true },
        })
      ).map((o) => o.campaign),
    );

    const lineInput = (line: DemoLine) =>
      'custom' in line
        ? {
            kind: 'CUSTOM' as const,
            name: line.custom,
            quantity: '1',
            unitPrice: line.price,
            customFields: line.fields,
          }
        : {
            kind: 'CATALOG' as const,
            variantId: variants[line.variant % variants.length] as string,
            quantity: line.quantity,
          };
    const customerId = (index: number): string | undefined =>
      customers.get(DEMO_CUSTOMERS[index % DEMO_CUSTOMERS.length]?.fullName ?? '');

    let created = 0;
    let existing = 0;

    for (const spec of DEMO_QUOTATIONS) {
      if (haveQuotation.has(tagOf(spec.tag))) {
        existing += 1;
        continue;
      }
      const id = customerId(spec.customer);
      if (!id) continue;
      await ctx.asOwner(async (owner: AuthUser) => {
        const q = await quotations.create(owner, {
          customerId: id,
          lines: spec.lines.map(lineInput),
          campaign: tagOf(spec.tag),
          source: 'MANUAL',
        });
        if (spec.end === 'draft') return;
        await quotations.send(owner, q.id, {});
        if (spec.end === 'rejected') {
          await quotations.reject(owner, q.id, { reason: 'Found a cheaper option elsewhere' });
        } else if (spec.end === 'expired') {
          await unscoped.quotation.update({
            where: { id: q.id },
            data: { validUntil: new Date(Date.now() - 5 * 86_400_000) },
          });
          await quotations.expireDue(ctx.workspaceId);
        } else if (spec.end === 'accepted' || spec.end === 'converted') {
          await quotations.accept(owner, q.id, { via: 'PHONE' });
          if (spec.end === 'converted') await quotations.convert(owner, q.id);
        }
      });
      created += 1;
    }

    // the orders are credited to the people who sell, so commissions have someone to go to
    const sellers = (
      await unscoped.user.findMany({
        where: { email: { in: ['salesperson@demo.test', 'cashier@demo.test'] } },
        select: { id: true, email: true },
        orderBy: { email: 'desc' },
      })
    ).map((u) => u.id);
    let orderIndex = 0;
    for (const spec of DEMO_ORDERS) {
      const seller = sellers.length > 0 ? sellers[orderIndex++ % sellers.length] : undefined;
      if (haveOrder.has(tagOf(spec.tag))) {
        existing += 1;
        continue;
      }
      const id = customerId(spec.customer);
      if (!id) continue;
      await ctx.asOwner(async (owner: AuthUser) => {
        const order = await orders.create(owner, {
          customerId: id,
          lines: spec.lines.map(lineInput),
          campaign: tagOf(spec.tag),
          source: 'STORE',
          ...(seller ? { assignedToId: seller } : {}),
        });
        for (const status of spec.path) {
          await orders.changeStatus(owner, order.id, {
            status,
            ...(status === 'cancelled' ? { reason: spec.cancelReason ?? 'Cancelled' } : {}),
          });
        }
      });
      created += 1;
    }
    return { created, existing };
  },
};
