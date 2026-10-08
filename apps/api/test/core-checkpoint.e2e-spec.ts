import Decimal from 'decimal.js';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { DocumentRenderer } from '../src/modules/documents/document-renderer';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { runDemoSeed } from '../src/seed/demo-seed';
import { DEMO_STEPS } from '../src/seed/steps';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { renderInNode, renderReceiptInNode } from './helpers/render-pdf-node';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

/**
 * Checkpoint 67: the core system on the demo dataset. A custom sofa goes from enquiry to a paid,
 * completed order; a customer buys at the counter; the reports and the Home indicators agree with
 * the records; and someone without financial permissions never sees a money figure.
 */
describe('Checkpoint — day 10: core system', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;
  let workspaceId: string;
  const tokens: Record<string, string> = {};

  const login = async (email: string) =>
    (await http.post('/auth/login', { email, password: 'demo-password-1' }).expect(200)).body.data
      .accessToken as string;
  const post = (who: string, path: string, body: object = {}, key?: string) => {
    const req = request(t.app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${tokens[who]}`)
      .set('X-Forwarded-For', `10.9.${(++n >> 8) & 255}.${n & 255}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const get = (who: string, path: string) => http.get(path, tokens[who] as string);
  const pdf = (who: string, path: string) =>
    request(t.app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${tokens[who]}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
    const renderer = t.app.get(DocumentRenderer);
    jest
      .spyOn(renderer, 'render')
      .mockImplementation((type, snapshot, options) =>
        renderInNode({ ...snapshot, type }, options),
      );
    jest
      .spyOn(renderer, 'renderReceipt')
      .mockImplementation((data, options) => renderReceiptInNode(data, options));
    const seeded = await runDemoSeed(
      {
        prisma: t.app.get(PrismaService),
        tenants: t.app.get(TenantsService),
        passwords: t.app.get(PasswordService),
        get: <T>(token: abstract new (...args: never[]) => T): T => t.app.get(token),
      },
      DEMO_STEPS,
      { password: 'demo-password-1' },
    );
    workspaceId = seeded.workspaceId;
    for (const who of ['owner', 'manager', 'salesperson', 'cashier', 'accounts']) {
      tokens[who] = await login(`${who}@demo.test`);
    }
  }, 180_000);
  afterAll(() => t.close());

  let orderId: string;
  let saleTotal: string;

  it('Workflow D and B: enquiry → custom sofa quotation → accepted → order → deposit → production → balance → completed', async () => {
    const lead = (
      await post('salesperson', '/leads', {
        fullName: 'Checkpoint Buyer',
        phone: '0300-7771234',
        interest: 'Custom corner sofa',
        source: 'SOCIAL',
      }).expect(201)
    ).body.data as Json;
    const quotation = (
      await post('salesperson', '/quotations', {
        leadId: lead.id,
        lines: [
          {
            kind: 'CUSTOM',
            name: 'Custom corner sofa',
            quantity: '1',
            unitPrice: '120000',
            customFields: { size_type: 'custom', length: { value: '9', unit: 'ft' } },
          },
        ],
      }).expect(201)
    ).body.data as Json;
    await post('salesperson', `/quotations/${quotation.id}/send`).expect(200);
    await post('salesperson', `/quotations/${quotation.id}/accept`, { via: 'PHONE' }).expect(200);
    const order = (await post('salesperson', `/quotations/${quotation.id}/convert`).expect(200))
      .body.data.order as Json;
    orderId = order.id;
    await post('salesperson', `/orders/${orderId}/status`, { status: 'confirmed' }).expect(200);
    expect((await get('salesperson', `/orders/${orderId}`)).body.data).toMatchObject({
      status: 'confirmed',
      depositRequired: '60000', // the furniture default is 50%
    });
    for (const path of [`/quotations/${quotation.id}/pdf`, `/orders/${orderId}/pdf`]) {
      expect(
        ((await pdf('salesperson', path).expect(200)).body as Buffer).subarray(0, 5).toString(),
      ).toBe('%PDF-');
    }

    // production cannot start before the deposit; the cashier records it
    await post('salesperson', `/orders/${orderId}/status`, { status: 'in_production' }).expect(422);
    const methods = (await get('cashier', '/settings/payment-methods')).body.data as Json[];
    const cash = methods.find((m) => m.name === 'Cash')?.id as string;
    await post(
      'accounts',
      '/payments',
      { type: 'DEPOSIT', orderId, paymentMethodId: cash, amount: '60000' },
      'cp67-1',
    ).expect(201);
    expect((await get('manager', `/orders/${orderId}`)).body.data).toMatchObject({
      status: 'deposit_paid',
      balanceDue: '60000',
    });
    for (const to of ['in_production', 'ready', 'out_for_delivery', 'delivered']) {
      await post('manager', `/orders/${orderId}/status`, { status: to }).expect(200);
    }
    const balance = (
      await post(
        'accounts',
        '/payments',
        { type: 'ORDER_PAYMENT', orderId, paymentMethodId: cash, amount: '60000' },
        'cp67-2',
      ).expect(201)
    ).body.data as Json;
    await post('accounts', `/payments/${balance.id}/void`, { reason: 'Counted wrong' }).expect(200);
    expect((await get('manager', `/orders/${orderId}`)).body.data.balanceDue).toBe('60000');
    await post(
      'accounts',
      '/payments',
      { type: 'ORDER_PAYMENT', orderId, paymentMethodId: cash, amount: '60000' },
      'cp67-3',
    ).expect(201);
    await post('manager', `/orders/${orderId}/status`, { status: 'completed' }).expect(200);
    expect((await get('manager', `/orders/${orderId}`)).body.data).toMatchObject({
      status: 'completed',
      paymentStatus: 'PAID',
      balanceDue: '0',
    });
    // completing it earned the salesperson a commission
    const mine = (await get('salesperson', '/commissions?status=PENDING')).body.data as Json[];
    expect(mine.some((c) => c.orderId === orderId)).toBe(true);
  });

  it('Workflow C: a walk-in sale deducts stock, takes the payment and prints at 80mm and A4, with the reprint marked', async () => {
    const variant = await t.db.prisma.productVariant.findFirstOrThrow({
      where: { workspaceId, product: { type: 'STOCKABLE', madeToOrder: false } },
      orderBy: { sku: 'asc' },
    });
    const onHand = async () =>
      (
        await t.db.prisma.stockLevel.findFirstOrThrow({
          where: { workspaceId, variantId: variant.id },
        })
      ).onHand.toFixed();
    const before = await onHand();
    const methods = (await get('cashier', '/settings/payment-methods')).body.data as Json[];
    const cash = methods.find((m) => m.name === 'Cash')?.id as string;
    const sale = (
      await post(
        'cashier',
        '/pos/checkout',
        { lines: [{ variantId: variant.id, quantity: '2' }], payment: { paymentMethodId: cash } },
        'cp67-pos',
      ).expect(201)
    ).body.data as Json;
    saleTotal = sale.order.totalAmount;
    expect(new Decimal(await onHand()).toString()).toBe(new Decimal(before).minus(2).toString());
    for (const paper of ['80mm', 'A4']) {
      const res = await pdf(
        'cashier',
        `/documents/receipts/${sale.receipt.id}/pdf?paper=${paper}`,
      ).expect(200);
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    }
    await post('cashier', `/pos/receipts/${sale.receipt.id}/reprint`).expect(200);
    expect((await get('cashier', `/pos/receipts/${sale.receipt.id}`)).body.data.reprintCount).toBe(
      1,
    );
    // the counter sale earned its commission straight away
    expect(await t.db.prisma.commission.count({ where: { orderId: sale.order.id } })).toBe(1);
  });

  it('the reports match the source records', async () => {
    const report = (await get('owner', '/reports/sales-by-date?from=2000-01-01&to=2100-01-01')).body
      .data as Json;
    const orders = await t.db.prisma.order.findMany({
      where: { workspaceId, NOT: { status: { in: ['draft', 'cancelled'] } } },
      select: { totalAmount: true },
    });
    expect(report.totals.total).toBe(
      orders.reduce((a, o) => a.plus(o.totalAmount.toFixed()), new Decimal(0)).toFixed(2),
    );
    expect(report.totals.orders).toBe(String(orders.length));

    const methods = (await get('owner', '/reports/payment-methods?from=2000-01-01&to=2100-01-01'))
      .body.data as Json;
    const payments = await t.db.prisma.payment.findMany({
      where: {
        workspaceId,
        status: 'CONFIRMED',
        type: { in: ['ORDER_PAYMENT', 'DEPOSIT', 'ADVANCE', 'REFUND'] },
      },
    });
    expect(methods.totals.net).toBe(
      payments
        .reduce(
          (a, p) =>
            p.type === 'REFUND' ? a.minus(p.amount.toFixed()) : a.plus(p.amount.toFixed()),
          new Decimal(0),
        )
        .toFixed(2),
    );
    expect(Number(saleTotal)).toBeGreaterThan(0);

    const home = (await get('owner', '/reports/dashboard')).body.data as Json;
    expect(home.salesMonth.total).toBe(
      (await get('owner', '/reports/sales-by-date?range=month')).body.data.totals.total,
    );
  });

  it('a user without financial permissions sees no money figure anywhere in the reports or on Home', async () => {
    const money =
      /"(total|totals|subtotal|discounts|tax|net|paid|balance|received|refunded|amount|ordered|estimatedValue|avgCost|stockValue|unitCost|salesToday|salesWeek|salesMonth|outstandingBalances)"/;
    const home = (await get('salesperson', '/reports/dashboard')).body.data as Json;
    expect(JSON.stringify(home)).not.toMatch(money);
    const catalogue = (await get('salesperson', '/reports')).body.data as Json[];
    expect(catalogue.length).toBeGreaterThan(0);
    for (const r of catalogue) {
      const run = (
        await get('salesperson', `/reports/${r.key}?from=2000-01-01&to=2100-01-01`).expect(200)
      ).body.data as Json;
      expect([r.key, JSON.stringify(run.rows).match(money)]).toEqual([r.key, null]);
      expect([r.key, JSON.stringify(run.totals).match(money)]).toEqual([r.key, null]);
    }
    await get('salesperson', '/reports/sales-by-date').expect(403);
  });
});
