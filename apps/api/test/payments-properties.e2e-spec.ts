import fc from 'fast-check';
import request from 'supertest';
import { calculateOrderBalance } from '@bms/calc';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Payments — properties (real PostgreSQL)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;
  let owner: { token: string };
  let sales: { token: string };
  let workspaceId: string;
  let customerId: string;
  let variantId: string;
  let cash: string;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
    const email = 'owner@pay-props.test';
    ({ workspaceId } = await t.app.get(TenantsService).createWorkspace({
      name: 'Pay props',
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      currency: 'PKR',
      country: 'PK',
    }));
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    owner = { token };
    const roles = (await http.get('/roles', token)).body.data as Json[];
    const invite = await http
      .post(
        '/users/invite',
        { email: 'sam@pay-props.test', roleIds: [roles.find((r) => r.name === 'Cashier')?.id] },
        token,
      )
      .expect(201);
    await http
      .post('/auth/invite/accept', {
        token: invite.body.data.token,
        password: 'member-password-1',
        firstName: 'S',
        lastName: 'S',
      })
      .expect(200);
    sales = {
      token: (
        await http
          .post('/auth/login', { email: 'sam@pay-props.test', password: 'member-password-1' })
          .expect(200)
      ).body.data.accessToken as string,
    };
    const product = (
      await http
        .post(
          '/catalog/products',
          {
            type: 'NON_STOCKABLE',
            code: 'P',
            name: 'P',
            basePrice: '1000.00',
            variants: [{ sku: 'P-A' }],
          },
          token,
        )
        .expect(201)
    ).body.data as Json;
    variantId = product.variants[0].id;
    customerId = (
      await http
        .post('/customers', { fullName: 'Prop Customer', phones: ['0300-9990000'] }, token)
        .expect(201)
    ).body.data.id;
    cash = ((await http.get('/settings/payment-methods', token)).body.data as Json[]).find(
      (m) => m.name === 'Cash',
    )?.id;
  }, 90_000);
  afterAll(() => t.close());

  const post = (who: { token: string }, path: string, body: object = {}, key?: string) => {
    const req = request(t.app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${who.token}`)
      .set('X-Forwarded-For', `10.44.${(++n >> 8) & 255}.${n & 255}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const newOrder = async (): Promise<string> => {
    const order = (
      await post(
        owner,
        '/orders',
        { customerId, lines: [{ variantId, quantity: '3' }] },
        `o-${++n}`,
      ).expect(201)
    ).body.data as Json;
    await post(owner, `/orders/${order.id}/status`, { status: 'confirmed' }).expect(200);
    return order.id;
  };
  const cents = (c: number) => (c / 100).toFixed(2);

  type Op =
    | { kind: 'record'; type: 'ORDER_PAYMENT' | 'DEPOSIT'; cents: number; pending: boolean }
    | { kind: 'advance'; cents: number }
    | { kind: 'confirm' | 'reject' | 'void'; pick: number }
    | { kind: 'applyCredit'; cents: number }
    | { kind: 'toCredit' };
  const amount = fc.integer({ min: 1, max: 400_000 });
  const op: fc.Arbitrary<Op> = fc.oneof(
    {
      weight: 5,
      arbitrary: fc.record({
        kind: fc.constant('record' as const),
        type: fc.constantFrom('ORDER_PAYMENT' as const, 'DEPOSIT' as const),
        cents: amount,
        pending: fc.boolean(),
      }),
    },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('advance' as const), cents: amount }) },
    {
      weight: 2,
      arbitrary: fc.record({
        kind: fc.constantFrom('confirm' as const, 'reject' as const, 'void' as const),
        pick: fc.nat(50),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({ kind: fc.constant('applyCredit' as const), cents: amount }),
    },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('toCredit' as const) }) },
  );

  it('Property 7 — balance consistency over random sequences of record, confirm, reject, void and credit operations (40.1)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 10 }), async (ops) => {
        const orderId = await newOrder();
        for (const step of ops) {
          const payments = await t.db.prisma.payment.findMany({
            where: { orderId },
            orderBy: { createdAt: 'asc' },
          });
          const pick = (status: string) => {
            const pool = payments.filter((p) => p.status === status);
            return pool.length === 0
              ? undefined
              : pool[('pick' in step ? step.pick : 0) % pool.length];
          };
          switch (step.kind) {
            case 'record':
              await post(
                step.pending ? sales : owner,
                '/payments',
                { type: step.type, orderId, paymentMethodId: cash, amount: cents(step.cents) },
                `p-${++n}`,
              );
              break;
            case 'advance':
              await post(
                owner,
                '/payments',
                { type: 'ADVANCE', customerId, paymentMethodId: cash, amount: cents(step.cents) },
                `a-${++n}`,
              );
              break;
            case 'confirm':
            case 'reject': {
              const target = pick('PENDING_VERIFICATION');
              if (target)
                await post(owner, `/payments/${target.id}/${step.kind}`, { reason: 'because' });
              break;
            }
            case 'void': {
              const target = pick('CONFIRMED');
              if (target) await post(owner, `/payments/${target.id}/void`, { reason: 'because' });
              break;
            }
            case 'applyCredit':
              await post(owner, `/customers/${customerId}/credit/apply`, {
                orderId,
                amount: cents(step.cents),
              });
              break;
            case 'toCredit':
              await post(owner, `/orders/${orderId}/overpayment-to-credit`);
              break;
          }

          // the invariant, after every step: the stored figures equal the recomputed ones
          const order = await t.db.prisma.order.findFirstOrThrow({ where: { id: orderId } });
          const all = await t.db.prisma.payment.findMany({ where: { orderId } });
          const expected = calculateOrderBalance({
            totalAmount: order.totalAmount.toFixed(),
            returnedAmount: order.returnedAmount.toFixed(),
            depositRequired: order.depositRequired.toFixed(),
            payments: all.map((p) => ({
              type: p.type,
              status: p.status,
              amount: p.amount.toFixed(),
            })),
          });
          expect({
            paid: order.paidAmount.toFixed(),
            refunded: order.refundedAmount.toFixed(),
            balance: order.balanceDue.toFixed(),
            status: order.paymentStatus,
          }).toEqual({
            paid: expected.paidAmount,
            refunded: expected.refundedAmount,
            balance: expected.balanceDue,
            status: expected.paymentStatus,
          });
          // payments that are not confirmed are not in the figures
          const confirmedPaid = all
            .filter(
              (p) =>
                p.status === 'CONFIRMED' &&
                ['ORDER_PAYMENT', 'DEPOSIT', 'CREDIT_APPLIED'].includes(p.type),
            )
            .reduce((a, p) => a + Number(p.amount), 0);
          expect(Number(order.paidAmount)).toBeCloseTo(confirmedPaid, 4);
          // credit never goes negative
          const credit = await t.db.prisma.customerCredit.aggregate({
            where: { customerId },
            _sum: { amount: true },
          });
          expect(Number(credit._sum.amount ?? 0)).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 12 },
    );
  }, 240_000);

  it('Property 16 — the same Idempotency-Key, however often and however concurrently, creates one payment (40.2)', async () => {
    const orderId = await newOrder();
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 2, max: 6 }),
        async (c, repeats) => {
          const key = `idem-${++n}`;
          const body = { type: 'ORDER_PAYMENT', orderId, paymentMethodId: cash, amount: cents(c) };
          const before = await t.db.prisma.payment.count({ where: { workspaceId } });
          const results = await Promise.all(
            Array.from({ length: repeats }, () => post(owner, '/payments', body, key)),
          );
          expect(new Set(results.map((r) => r.status))).toEqual(new Set([201]));
          expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
          expect(new Set(results.map((r) => r.body.data.paymentNumber)).size).toBe(1);
          expect(await t.db.prisma.payment.count({ where: { workspaceId } })).toBe(before + 1);
          // a later repeat still returns the first answer
          const later = await post(owner, '/payments', body, key);
          expect(later.body.data.id).toBe(results[0]!.body.data.id);
          // the same key with a different amount is refused and creates nothing
          const other = await post(owner, '/payments', { ...body, amount: cents(c + 1) }, key);
          expect(other.status).toBe(409);
          expect(await t.db.prisma.payment.count({ where: { workspaceId } })).toBe(before + 1);
        },
      ),
      { numRuns: 8 },
    );
    // and the order counted each payment once
    const order = await t.db.prisma.order.findFirstOrThrow({ where: { id: orderId } });
    const sum = (
      await t.db.prisma.payment.aggregate({
        where: { orderId, status: 'CONFIRMED' },
        _sum: { amount: true },
      })
    )._sum.amount;
    expect(order.paidAmount.toFixed()).toBe((sum ?? 0).toString() === '0' ? '0' : sum!.toFixed());
  }, 120_000);
});
