import request from 'supertest';
import { SettingsService } from '../src/modules/settings/settings.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { runWithWorkspace } from './helpers/context';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Payments API (real PostgreSQL)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;
  let keys = 0;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
  }, 90_000);
  afterAll(() => t.close());

  async function business(depositPercent = 30) {
    const email = `owner${++n}@pay.test`;
    const created = await t.app.get(TenantsService).createWorkspace({
      name: `Pay ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'Olivia', lastName: 'Owner', password: 'owner-password-1' },
      currency: 'PKR',
      country: 'PK',
    });
    await runWithWorkspace(t.app, created.workspaceId, () =>
      t.app.get(SettingsService).update({ sales: { requiredDepositPercent: depositPercent } }),
    );
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const roles = (await http.get('/roles', token)).body.data as Json[];
    const product = (
      await http
        .post(
          '/catalog/products',
          { code: 'SOFA', name: 'Sofa', basePrice: '1000.00', variants: [{ sku: 'SOFA-A' }] },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const customer = (
      await http.post('/customers', { fullName: 'Sana Malik', phones: ['0300-1234567'] }, token)
    ).body.data as Json;
    const methods = (await http.get('/settings/payment-methods', token).expect(200)).body
      .data as Json[];
    const method = (name: string) => methods.find((m) => m.name === name)?.id as string;
    return {
      ...created,
      token,
      roles,
      customer,
      variantId: product.variants[0].id as string,
      cash: method('Cash'),
      bank: method('Bank transfer'),
    };
  }
  type Biz = Awaited<ReturnType<typeof business>>;

  async function member(b: Biz, roleName: string) {
    const email = `${roleName.toLowerCase().replace(/\W/g, '')}${++n}@pay.test`;
    const role = b.roles.find((r) => r.name === roleName) as Json;
    const invite = await http
      .post('/users/invite', { email, roleIds: [role.id] }, b.token)
      .expect(201);
    await http
      .post('/auth/invite/accept', {
        token: invite.body.data.token,
        password: 'member-password-1',
        firstName: roleName,
        lastName: 'Person',
      })
      .expect(200);
    const token = (
      await http.post('/auth/login', { email, password: 'member-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const me = (await http.get('/auth/me', token)).body.data;
    return { token, userId: me.user.id as string };
  }

  const ip = () => `10.55.${(++n >> 8) & 255}.${n & 255}`;
  const post = (who: { token: string }, path: string, body: object = {}, key?: string) => {
    const req = request(t.app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${who.token}`)
      .set('X-Forwarded-For', ip());
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  /** A confirmed order of 2000 (2 sofas), deposit 30% = 600 when the percentage is 30. */
  async function confirmedOrder(b: Biz, who: { token: string } = b, extra: object = {}) {
    const order = (
      await post(
        who,
        '/orders',
        {
          customerId: b.customer.id,
          lines: [{ variantId: b.variantId, quantity: '2' }],
          ...extra,
        },
        `ord-${++keys}`,
      ).expect(201)
    ).body.data as Json;
    await post(who, `/orders/${order.id}/status`, { status: 'confirmed' }).expect(200);
    return (await http.get(`/orders/${order.id}`, b.token)).body.data as Json;
  }
  const pay = (who: { token: string }, body: object) =>
    post(who, '/payments', body, `pay-${++keys}`);
  const orderOf = async (b: Biz, id: string) =>
    (await http.get(`/orders/${id}`, b.token).expect(200)).body.data as Json;

  describe('accounts and payment methods (40.1 to 40.3)', () => {
    it('lists the defaults; bank details are shown only to people who manage accounts', async () => {
      const b = await business();
      const accounts = (await http.get('/settings/financial-accounts', b.token).expect(200)).body
        .data as Json[];
      expect(accounts.map((a) => a.type).sort()).toEqual(
        ['BANK', 'CARD_TERMINAL', 'CASH', 'MOBILE_WALLET'].sort(),
      );
      await http
        .post(
          '/settings/financial-accounts',
          {
            type: 'BANK',
            name: 'HBL current',
            bankName: 'HBL',
            accountTitle: 'Acme Furniture',
            accountNumber: 'PK00HABB0000000001',
            showToCustomers: true,
          },
          b.token,
        )
        .expect(201);
      const cashier = await member(b, 'Cashier');
      const asCashier = (await http.get('/settings/financial-accounts', cashier.token).expect(200))
        .body.data as Json[];
      expect(JSON.stringify(asCashier)).not.toMatch(/PK00HABB/);
      const asOwner = (await http.get('/settings/financial-accounts', b.token)).body.data as Json[];
      expect(asOwner.find((a) => a.name === 'HBL current')).toMatchObject({
        accountNumber: 'PK00HABB0000000001',
        showToCustomers: true,
      });
      const viewer = await member(b, 'Viewer');
      await http.get('/settings/payment-methods', viewer.token).expect(403);
    });

    it('creates and edits accounts and methods, with rules', async () => {
      const b = await business();
      const bank = (
        await http
          .post(
            '/settings/financial-accounts',
            { type: 'BANK', name: 'Meezan', bankName: 'Meezan' },
            b.token,
          )
          .expect(201)
      ).body.data as Json;
      await http
        .post(
          '/settings/financial-accounts',
          { type: 'CASH', name: 'Till 2', bankName: 'x' },
          b.token,
        )
        .expect(400);
      await http
        .post('/settings/financial-accounts', { type: 'BANK', name: 'Meezan' }, b.token)
        .expect(400);
      const method = (
        await http
          .post(
            '/settings/payment-methods',
            {
              name: 'Meezan transfer',
              type: 'BANK_TRANSFER',
              accountId: bank.id,
              requiresReference: true,
            },
            b.token,
          )
          .expect(201)
      ).body.data as Json;
      await http
        .post(
          '/settings/payment-methods',
          { name: 'Bad', type: 'CASH', accountId: 'nope' },
          b.token,
        )
        .expect(400);
      // an account that methods use cannot be switched off
      await http
        .patch(`/settings/financial-accounts/${bank.id}`, { active: false }, b.token)
        .expect(400);
      await http
        .patch(`/settings/payment-methods/${method.id}`, { active: false }, b.token)
        .expect(200);
      await http
        .patch(`/settings/financial-accounts/${bank.id}`, { active: false }, b.token)
        .expect(200);
      const cashier = await member(b, 'Cashier');
      await post(cashier, '/settings/financial-accounts', { type: 'CASH', name: 'x' }).expect(403);
      const audit = await t.db.prisma.auditEvent.count({
        where: { workspaceId: b.workspaceId, action: { startsWith: 'account.' } },
      });
      expect(audit).toBeGreaterThanOrEqual(2);
    });
  });

  describe('recording a payment (40.5, 13.4)', () => {
    it('a person who may confirm records a CONFIRMED payment; the order balance and status follow', async () => {
      const b = await business();
      const order = await confirmedOrder(b);
      expect(order.depositRequired).toBe('600');
      const res = await pay(b, {
        type: 'DEPOSIT',
        orderId: order.id,
        paymentMethodId: b.cash,
        amount: '600',
      }).expect(201);
      expect(res.body.data).toMatchObject({
        status: 'CONFIRMED',
        type: 'DEPOSIT',
        amount: '600',
        confirmedById: expect.any(String),
      });
      expect(res.body.data.paymentNumber).toMatch(/^PAY-\d{4}-00001$/);
      const after = await orderOf(b, order.id);
      expect(after).toMatchObject({
        paidAmount: '600',
        balanceDue: '1400',
        paymentStatus: 'DEPOSIT_PAID',
        status: 'deposit_paid', // entered automatically (Requirement 11)
      });
      const second = await pay(b, {
        type: 'ORDER_PAYMENT',
        orderId: order.id,
        paymentMethodId: b.cash,
        amount: '1400',
      }).expect(201);
      expect((await orderOf(b, order.id)).paymentStatus).toBe('PAID');
      expect((await orderOf(b, order.id)).balanceDue).toBe('0');
      // each confirmed payment has a numbered receipt with a snapshot
      const receipt = (
        await http.get(`/payments/${second.body.data.id}/receipt`, b.token).expect(200)
      ).body.data as Json;
      expect(receipt.receiptNumber).toMatch(/^RCP-\d{4}-00002$/);
      expect(receipt.data.order).toMatchObject({ number: order.orderNumber, balanceDue: '0' });
      expect(receipt.data.payment).toMatchObject({ amount: '1400', method: 'Cash' });
    });

    it('a person who may not confirm records a PENDING payment that changes nothing until confirmed (40.6)', async () => {
      const b = await business();
      const sales = await member(b, 'Salesperson');
      const order = await confirmedOrder(b, sales);
      const res = await pay(sales, {
        type: 'DEPOSIT',
        orderId: order.id,
        paymentMethodId: b.cash,
        amount: '600',
      }).expect(201);
      expect(res.body.data.status).toBe('PENDING_VERIFICATION');
      expect(await orderOf(b, order.id)).toMatchObject({
        paidAmount: '0',
        paymentStatus: 'UNPAID',
      });
      await http.get(`/payments/${res.body.data.id}/receipt`, b.token).expect(404);
      // the salesperson cannot confirm their own
      await post(sales, `/payments/${res.body.data.id}/confirm`).expect(403);
      const confirmed = await post(b, `/payments/${res.body.data.id}/confirm`).expect(200);
      expect(confirmed.body.data).toMatchObject({
        status: 'CONFIRMED',
        confirmedAt: expect.any(String),
      });
      expect(await orderOf(b, order.id)).toMatchObject({
        paidAmount: '600',
        paymentStatus: 'DEPOSIT_PAID',
        status: 'deposit_paid',
      });
      await post(b, `/payments/${res.body.data.id}/confirm`).expect(422); // already decided
    });

    it('rejecting keeps the balance and needs a reason', async () => {
      const b = await business();
      const sales = await member(b, 'Salesperson');
      const order = await confirmedOrder(b, sales);
      const p = (
        await pay(sales, {
          type: 'DEPOSIT',
          orderId: order.id,
          paymentMethodId: b.cash,
          amount: '600',
        }).expect(201)
      ).body.data as Json;
      await post(b, `/payments/${p.id}/reject`).expect(400);
      const rejected = await post(b, `/payments/${p.id}/reject`, {
        reason: 'No such transfer',
      }).expect(200);
      expect(rejected.body.data).toMatchObject({
        status: 'REJECTED',
        rejectedReason: 'No such transfer',
      });
      expect((await orderOf(b, order.id)).paidAmount).toBe('0');
      await post(b, `/payments/${p.id}/void`, { reason: 'x' }).expect(422); // only confirmed can be voided
    });

    it('validates the method, the reference number, the amount and the order state', async () => {
      const b = await business();
      const draft = (
        await post(
          b,
          '/orders',
          { customerId: b.customer.id, lines: [{ variantId: b.variantId, quantity: '1' }] },
          `o-${++keys}`,
        ).expect(201)
      ).body.data as Json;
      const base = {
        type: 'ORDER_PAYMENT',
        orderId: draft.id,
        paymentMethodId: b.cash,
        amount: '100',
      };
      await pay(b, base).expect(422); // still a draft
      const order = await confirmedOrder(b);
      const ok = { ...base, orderId: order.id };
      await pay(b, { ...ok, paymentMethodId: b.bank, amount: '100' }).expect(400); // reference required
      await pay(b, { ...ok, paymentMethodId: b.bank, referenceNumber: 'TX-1' }).expect(201);
      await pay(b, { ...ok, amount: '0' }).expect(400);
      await pay(b, { ...ok, amount: '-5' }).expect(400);
      await pay(b, { ...ok, amount: '1.5.2' }).expect(400);
      await pay(b, { ...ok, paymentMethodId: 'nope' }).expect(400);
      await pay(b, { ...ok, orderId: 'nope' }).expect(404);
      await pay(b, { type: 'ORDER_PAYMENT', paymentMethodId: b.cash, amount: '5' }).expect(400);
      await pay(b, {
        type: 'ADVANCE',
        orderId: order.id,
        paymentMethodId: b.cash,
        amount: '5',
      }).expect(400);
      await pay(b, {
        type: 'REFUND',
        orderId: order.id,
        paymentMethodId: b.cash,
        amount: '5',
      }).expect(400);
      await post(b, '/payments', ok).expect(400); // Idempotency-Key required

      await post(b, `/orders/${order.id}/status`, {
        status: 'cancelled',
        reason: 'x',
        paymentDecision: 'CREDIT',
      }).expect(200);
      await pay(b, { ...ok, amount: '10' }).expect(422); // cancelled
    });
  });

  describe('voiding (40.7)', () => {
    it('voiding a confirmed payment restores the balance and keeps the record; a reason is required', async () => {
      const b = await business();
      const order = await confirmedOrder(b);
      const p = (
        await pay(b, {
          type: 'DEPOSIT',
          orderId: order.id,
          paymentMethodId: b.cash,
          amount: '600',
        }).expect(201)
      ).body.data as Json;
      await post(b, `/payments/${p.id}/void`).expect(400);
      const voided = await post(b, `/payments/${p.id}/void`, { reason: 'Entered twice' }).expect(
        200,
      );
      expect(voided.body.data).toMatchObject({ status: 'VOIDED', voidReason: 'Entered twice' });
      expect(await orderOf(b, order.id)).toMatchObject({
        paidAmount: '0',
        balanceDue: '2000',
        paymentStatus: 'UNPAID',
      });
      const events = await t.db.prisma.auditEvent.findMany({
        where: { workspaceId: b.workspaceId, entityId: p.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(events.map((e) => e.action)).toEqual(['payment.record', 'payment.void']);
      expect(JSON.stringify(events[1])).toMatch(/CONFIRMED/);
      await post(b, `/payments/${p.id}/void`, { reason: 'again' }).expect(422);
    });

    it('needs payment:void', async () => {
      const b = await business();
      const accounts = await member(b, 'Account Staff');
      const order = await confirmedOrder(b);
      const p = (
        await pay(b, {
          type: 'DEPOSIT',
          orderId: order.id,
          paymentMethodId: b.cash,
          amount: '600',
        }).expect(201)
      ).body.data as Json;
      const sales = await member(b, 'Salesperson');
      await post(sales, `/payments/${p.id}/void`, { reason: 'x' }).expect(403);
      const cashier = await member(b, 'Cashier');
      await post(cashier, `/payments/${p.id}/void`, { reason: 'x' }).expect(403);
      await post(accounts, `/payments/${p.id}/void`, { reason: 'Entered twice' }).expect(200);
    });
  });

  describe('customer credit (40.8)', () => {
    it('an advance becomes credit, which can be applied to an order, and voiding restores both', async () => {
      const b = await business();
      const advance = (
        await pay(b, {
          type: 'ADVANCE',
          customerId: b.customer.id,
          paymentMethodId: b.cash,
          amount: '1500',
        }).expect(201)
      ).body.data as Json;
      expect(advance.orderId).toBeNull();
      let credit = (await http.get(`/customers/${b.customer.id}/credit`, b.token).expect(200)).body
        .data as Json;
      expect(credit.balance).toBe('1500');
      expect(credit.entries).toEqual([
        expect.objectContaining({ reason: 'ADVANCE', amount: '1500' }),
      ]);

      const order = await confirmedOrder(b);
      await post(b, `/customers/${b.customer.id}/credit/apply`, {
        orderId: order.id,
        amount: '2000',
      }).expect(400); // more than credit
      const applied = await post(b, `/customers/${b.customer.id}/credit/apply`, {
        orderId: order.id,
        amount: '700',
      }).expect(201);
      expect(applied.body.data).toMatchObject({
        type: 'CREDIT_APPLIED',
        status: 'CONFIRMED',
        amount: '700',
      });
      expect(await orderOf(b, order.id)).toMatchObject({ paidAmount: '700', balanceDue: '1300' });
      credit = (await http.get(`/customers/${b.customer.id}/credit`, b.token)).body.data as Json;
      expect(credit.balance).toBe('800');

      // the advance cannot be voided while its credit is partly spent
      await post(b, `/payments/${advance.id}/void`, { reason: 'x' }).expect(422);
      await post(b, `/payments/${applied.body.data.id}/void`, { reason: 'wrong order' }).expect(
        200,
      );
      expect(await orderOf(b, order.id)).toMatchObject({ paidAmount: '0', balanceDue: '2000' });
      expect(
        ((await http.get(`/customers/${b.customer.id}/credit`, b.token)).body.data as Json).balance,
      ).toBe('1500');
      await post(b, `/payments/${advance.id}/void`, { reason: 'entered by mistake' }).expect(200);
      expect(
        ((await http.get(`/customers/${b.customer.id}/credit`, b.token)).body.data as Json).balance,
      ).toBe('0');
    });

    it('applying credit is limited to what the order still owes and to people who may confirm', async () => {
      const b = await business();
      await pay(b, {
        type: 'ADVANCE',
        customerId: b.customer.id,
        paymentMethodId: b.cash,
        amount: '5000',
      }).expect(201);
      const order = await confirmedOrder(b);
      await post(b, `/customers/${b.customer.id}/credit/apply`, {
        orderId: order.id,
        amount: '2500',
      }).expect(400);
      const sales = await member(b, 'Salesperson');
      await post(sales, `/customers/${b.customer.id}/credit/apply`, {
        orderId: order.id,
        amount: '10',
      }).expect(403);
      await post(b, `/customers/${b.customer.id}/credit/apply`, {
        orderId: order.id,
        amount: '2000',
      }).expect(201);
      expect((await orderOf(b, order.id)).paymentStatus).toBe('PAID');
    });

    it('an overpayment is flagged and moved to credit with one action', async () => {
      const b = await business();
      const order = await confirmedOrder(b);
      await post(b, `/orders/${order.id}/overpayment-to-credit`).expect(422); // nothing over yet
      await pay(b, {
        type: 'ORDER_PAYMENT',
        orderId: order.id,
        paymentMethodId: b.cash,
        amount: '2300',
      }).expect(201);
      expect(await orderOf(b, order.id)).toMatchObject({
        paymentStatus: 'OVERPAID',
        balanceDue: '-300',
      });
      const moved = await post(b, `/orders/${order.id}/overpayment-to-credit`).expect(200);
      expect(moved.body.data).toMatchObject({
        type: 'REFUND',
        amount: '300',
        paymentMethodId: null,
      });
      expect(await orderOf(b, order.id)).toMatchObject({
        paymentStatus: 'PAID',
        balanceDue: '0',
        refundedAmount: '300',
      });
      expect(
        ((await http.get(`/customers/${b.customer.id}/credit`, b.token)).body.data as Json).balance,
      ).toBe('300');
    });

    it('cancelling a paid order needs a decision, and keeps the money as credit', async () => {
      const b = await business();
      const order = await confirmedOrder(b);
      await pay(b, {
        type: 'DEPOSIT',
        orderId: order.id,
        paymentMethodId: b.cash,
        amount: '600',
      }).expect(201);
      const refused = await post(b, `/orders/${order.id}/status`, {
        status: 'cancelled',
        reason: 'Changed mind',
      }).expect(400);
      expect(refused.body.details.paymentDecision).toBeDefined();
      await post(b, `/orders/${order.id}/status`, {
        status: 'cancelled',
        reason: 'Changed mind',
        paymentDecision: 'CREDIT',
      }).expect(200);
      expect(
        ((await http.get(`/customers/${b.customer.id}/credit`, b.token)).body.data as Json).balance,
      ).toBe('600');
      expect((await orderOf(b, order.id)).status).toBe('cancelled');
    });
  });

  describe('listing, timeline and permissions (40.9)', () => {
    it('lists payments with filters, and records them on the order and customer timelines', async () => {
      const b = await business();
      const order = await confirmedOrder(b);
      for (const amount of ['100', '200', '300']) {
        await pay(b, {
          type: 'ORDER_PAYMENT',
          orderId: order.id,
          paymentMethodId: b.cash,
          amount,
        }).expect(201);
      }
      const first = (await http.get('/payments?limit=2', b.token).expect(200)).body as Json;
      expect(first.data).toHaveLength(2);
      const second = (await http.get(`/payments?limit=2&cursor=${first.meta.nextCursor}`, b.token))
        .body as Json;
      expect(second.data).toHaveLength(1);
      expect(
        (await http.get(`/payments?orderId=${order.id}&status=CONFIRMED`, b.token)).body
          .data as Json[],
      ).toHaveLength(3);
      expect((await http.get('/payments?status=VOIDED', b.token)).body.data as Json[]).toHaveLength(
        0,
      );
      const timeline = (await http.get(`/orders/${order.id}/timeline`, b.token).expect(200)).body
        .data as Json[];
      expect(timeline.filter((e) => e.type === 'PAYMENT')).toHaveLength(3);
      const customerTimeline = (await http.get(`/customers/${b.customer.id}/timeline`, b.token))
        .body.data as Json[];
      expect(customerTimeline.some((e) => e.type === 'PAYMENT')).toBe(true);
    });

    it('people without financial permissions see no payment data', async () => {
      const b = await business();
      const order = await confirmedOrder(b);
      await pay(b, {
        type: 'DEPOSIT',
        orderId: order.id,
        paymentMethodId: b.cash,
        amount: '600',
      }).expect(201);
      const viewer = await member(b, 'Viewer');
      await http.get('/payments', viewer.token).expect(403);
      await http.get(`/customers/${b.customer.id}/credit`, viewer.token).expect(403);
      await post(viewer, `/orders/${order.id}/overpayment-to-credit`).expect(403);
      await http.get('/payments').expect(401);
    });

    it("another workspace cannot see or change a payment, or use another's order", async () => {
      const a = await business();
      const other = await business();
      const order = await confirmedOrder(a);
      const p = (
        await pay(a, {
          type: 'DEPOSIT',
          orderId: order.id,
          paymentMethodId: a.cash,
          amount: '600',
        }).expect(201)
      ).body.data as Json;
      await http.get(`/payments/${p.id}`, other.token).expect(404);
      await post(other, `/payments/${p.id}/void`, { reason: 'x' }).expect(404);
      await http.get(`/payments/${p.id}/receipt`, other.token).expect(404);
      await pay(other, {
        type: 'DEPOSIT',
        orderId: order.id,
        paymentMethodId: other.cash,
        amount: '1',
      }).expect(404);
      await pay(other, {
        type: 'DEPOSIT',
        orderId: other.customer.id,
        paymentMethodId: a.cash,
        amount: '1',
      }).expect((r) => expect([400, 404]).toContain(r.status));
      expect((await http.get('/payments', other.token)).body.data as Json[]).toHaveLength(0);
    });
  });
});
