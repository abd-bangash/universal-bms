import request from 'supertest';
import { bankDetailsText } from '../src/modules/finance/bank-details';
import type { DocumentSnapshot } from '../src/modules/documents/document.types';
import { SettingsService } from '../src/modules/settings/settings.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { runWithWorkspace } from './helpers/context';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Receivables and bank details (real PostgreSQL)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
  }, 90_000);
  afterAll(() => t.close());

  async function business() {
    const email = `owner${++n}@recv.test`;
    const created = await t.app.get(TenantsService).createWorkspace({
      name: `Recv ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      currency: 'PKR',
      country: 'PK',
    });
    await runWithWorkspace(t.app, created.workspaceId, () =>
      t.app.get(SettingsService).update({ sales: { requiredDepositPercent: 0 } }),
    );
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const roles = (await http.get('/roles', token)).body.data as Json[];
    const product = (
      await http
        .post(
          '/catalog/products',
          { code: 'P', name: 'P', basePrice: '1000.00', variants: [{ sku: 'P-A' }] },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const methods = (await http.get('/settings/payment-methods', token)).body.data as Json[];
    return {
      ...created,
      token,
      roles,
      variantId: product.variants[0].id as string,
      cash: methods.find((m) => m.name === 'Cash')?.id as string,
    };
  }
  type Biz = Awaited<ReturnType<typeof business>>;

  const ip = () => `10.22.${(++n >> 8) & 255}.${n & 255}`;
  const post = (who: { token: string }, path: string, body: object = {}, key?: string) => {
    const req = request(t.app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${who.token}`)
      .set('X-Forwarded-For', ip());
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const customer = async (b: Biz, name: string) =>
    (
      await http
        .post(
          '/customers',
          { fullName: name, phones: [`0300${String(1000000 + ++n)}`] },
          b.token,
        )
        .expect(201)
    ).body.data.id as string;
  async function order(
    b: Biz,
    customerId: string,
    quantity: string,
    paid = '0',
    daysAgo = 0,
    confirm = true,
  ) {
    const o = (
      await post(
        b,
        '/orders',
        { customerId, lines: [{ variantId: b.variantId, quantity }] },
        `o-${++n}`,
      ).expect(201)
    ).body.data as Json;
    if (confirm) await post(b, `/orders/${o.id}/status`, { status: 'confirmed' }).expect(200);
    if (Number(paid) > 0) {
      await post(
        b,
        '/payments',
        { type: 'ORDER_PAYMENT', orderId: o.id, paymentMethodId: b.cash, amount: paid },
        `p-${++n}`,
      ).expect(201);
    }
    if (daysAgo > 0) {
      await t.db.prisma.order.update({
        where: { id: o.id },
        data: { orderDate: new Date(Date.now() - daysAgo * 86_400_000) },
      });
    }
    return o;
  }

  describe('receivables summary (13.4)', () => {
    it('shows invoiced, paid and outstanding per customer, largest debt first, with ageing', async () => {
      const b = await business();
      const ayesha = await customer(b, 'Ayesha');
      const bilal = await customer(b, 'Bilal');
      const settled = await customer(b, 'Settled');
      await order(b, ayesha, '2', '500'); // 2000 invoiced, 500 paid, 1500 owed, current
      await order(b, ayesha, '1', '0', 45); // 1000 owed, 31-60 days
      await order(b, bilal, '5', '1000', 100); // 5000, 1000 paid, 4000 owed, over 90
      await order(b, settled, '1', '1000');
      const res = (await http.get('/payments/receivables-summary', b.token).expect(200)).body
        .data as Json;
      expect(res.customers.map((c: Json) => c.customerName)).toEqual(['Bilal', 'Ayesha']);
      expect(res.customers[0]).toMatchObject({
        invoiced: '5000',
        paid: '1000',
        outstanding: '4000',
        orders: 1,
      });
      expect(res.customers[0].ageing).toEqual({
        current: '0',
        days31to60: '0',
        days61to90: '0',
        over90: '4000',
      });
      expect(res.customers[1]).toMatchObject({
        invoiced: '3000',
        paid: '500',
        outstanding: '2500',
        orders: 2,
      });
      expect(res.customers[1].ageing).toEqual({
        current: '1500',
        days31to60: '1000',
        days61to90: '0',
        over90: '0',
      });
      expect(res.totals).toEqual({ invoiced: '8000', paid: '1500', outstanding: '6500' });

      const all = (await http.get('/payments/receivables-summary?includeSettled=true', b.token))
        .body.data as Json;
      expect(all.customers.map((c: Json) => c.customerName)).toContain('Settled');
      const one = (await http.get(`/payments/receivables-summary?customerId=${ayesha}`, b.token))
        .body.data as Json;
      expect(one.customers).toHaveLength(1);
    });

    it('leaves out drafts and cancelled orders, and follows payments being voided', async () => {
      const b = await business();
      const c = await customer(b, 'Cara');
      await order(b, c, '1', '0', 0, false); // draft
      const cancelled = await order(b, c, '3');
      await post(b, `/orders/${cancelled.id}/status`, { status: 'cancelled', reason: 'x' }).expect(
        200,
      );
      const real = await order(b, c, '2', '800');
      let res = (await http.get('/payments/receivables-summary', b.token)).body.data as Json;
      expect(res.customers[0]).toMatchObject({
        invoiced: '2000',
        paid: '800',
        outstanding: '1200',
        orders: 1,
      });
      const pay = await t.db.prisma.payment.findFirstOrThrow({ where: { orderId: real.id } });
      await post(b, `/payments/${pay.id}/void`, { reason: 'bounced' }).expect(200);
      res = (await http.get('/payments/receivables-summary', b.token)).body.data as Json;
      expect(res.customers[0]).toMatchObject({ paid: '0', outstanding: '2000' });
    });

    it('is for people with payment:view only, and shows only the workspace’s own customers', async () => {
      const a = await business();
      const other = await business();
      await order(a, await customer(a, 'Only A'), '1');
      const invite = await http
        .post(
          '/users/invite',
          {
            email: `v${n}@recv.test`,
            roleIds: [(a.roles.find((r) => r.name === 'Viewer') as Json).id],
          },
          a.token,
        )
        .expect(201);
      await http
        .post('/auth/invite/accept', {
          token: invite.body.data.token,
          password: 'member-password-1',
          firstName: 'V',
          lastName: 'V',
        })
        .expect(200);
      const viewer = (
        await http
          .post('/auth/login', { email: `v${n}@recv.test`, password: 'member-password-1' })
          .expect(200)
      ).body.data.accessToken as string;
      await http.get('/payments/receivables-summary', viewer).expect(403);
      expect(
        ((await http.get('/payments/receivables-summary', other.token)).body.data as Json)
          .customers,
      ).toEqual([]);
    });
  });

  describe('bank details on documents (40.2, 40.11, 29.2)', () => {
    async function setup() {
      const b = await business();
      const c = await customer(b, 'Docs customer');
      await http
        .post(
          '/settings/financial-accounts',
          {
            type: 'BANK',
            name: 'HBL current',
            bankName: 'HBL',
            accountTitle: 'Acme Furniture',
            accountNumber: 'PK00HABB0001',
            branch: 'Gulberg',
            showToCustomers: true,
          },
          b.token,
        )
        .expect(201);
      await http
        .post(
          '/settings/financial-accounts',
          {
            type: 'BANK',
            name: 'Internal payroll',
            bankName: 'MCB',
            accountNumber: 'SECRET-9999',
            showToCustomers: false,
          },
          b.token,
        )
        .expect(201);
      return { b, c };
    }
    const invoiceSnapshot = async (orderId: string) =>
      (await t.db.prisma.invoice.findFirstOrThrow({ where: { orderId } }))
        .data as unknown as DocumentSnapshot;

    it('puts only the customer-facing accounts on the invoice and the sent quotation', async () => {
      const { b, c } = await setup();
      const o = await order(b, c, '1');
      await post(b, `/orders/${o.id}/invoice`).expect(201);
      const snap = await invoiceSnapshot(o.id);
      expect(JSON.stringify(snap.bankDetails)).toContain('PK00HABB0001');
      expect(JSON.stringify(snap.bankDetails)).not.toContain('SECRET-9999');
      expect(snap.bankDetails).toEqual([
        {
          Account: 'HBL current',
          Bank: 'HBL',
          'Account title': 'Acme Furniture',
          'Account number': 'PK00HABB0001',
          Branch: 'Gulberg',
        },
      ]);
      const q = (
        await http
          .post(
            '/quotations',
            { customerId: c, lines: [{ variantId: b.variantId, quantity: '1' }] },
            b.token,
          )
          .expect(201)
      ).body.data as Json;
      await http.post(`/quotations/${q.id}/send`, {}, b.token).expect(200);
      const sent = (await t.db.prisma.quotation.findFirstOrThrow({ where: { id: q.id } }))
        .sentSnapshot as unknown as DocumentSnapshot;
      expect(JSON.stringify(sent.bankDetails)).toContain('PK00HABB0001');
    });

    it('leaves them off when the workspace turns the block off, or when no account is customer-facing', async () => {
      const { b, c } = await setup();
      await runWithWorkspace(t.app, b.workspaceId, () =>
        t.app.get(SettingsService).update({ documents: { showBankDetails: false } }),
      );
      const o = await order(b, c, '1');
      await post(b, `/orders/${o.id}/invoice`).expect(201);
      expect((await invoiceSnapshot(o.id)).bankDetails).toBeNull();

      const bare = await business();
      const o2 = await order(bare, await customer(bare, 'No accounts'), '1');
      await post(bare, `/orders/${o2.id}/invoice`).expect(201);
      expect((await invoiceSnapshot(o2.id)).bankDetails).toBeNull();
    });

    it('lists the confirmed payments on the invoice, with the balance', async () => {
      const { b, c } = await setup();
      const o = await order(b, c, '2', '600');
      await post(b, `/orders/${o.id}/invoice`).expect(201);
      const snap = await invoiceSnapshot(o.id);
      expect(snap.payments).toEqual([expect.objectContaining({ method: 'Cash', amount: '600' })]);
      expect(snap).toMatchObject({ paidAmount: '600', balanceDue: '1400' });
    });

    it('the {{bank_details}} text lists each account', () => {
      expect(
        bankDetailsText([
          { Account: 'A', Bank: 'HBL', 'Account number': '1' },
          { Account: 'B', Bank: 'MCB' },
        ]),
      ).toBe('Account: A\nBank: HBL\nAccount number: 1\n\nAccount: B\nBank: MCB');
      expect(bankDetailsText([])).toBe('');
    });
  });
});
