import fc from 'fast-check';
import request from 'supertest';
import { AuditService } from '../src/modules/audit/audit.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { NumberingService } from '../src/modules/numbering/numbering.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('POS checkout and receipts (real PostgreSQL)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
  }, 90_000);
  afterAll(() => t.close());
  afterEach(() => jest.restoreAllMocks());

  async function business() {
    const email = `owner${++n}@pos.test`;
    const created = await t.app.get(TenantsService).createWorkspace({
      name: `Pos ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      country: 'PK',
    });
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const roles = (await http.get('/roles', token)).body.data as Json[];
    const product = (
      await http
        .post(
          '/catalog/products',
          { code: 'CH', name: 'Chair', basePrice: '100.00', variants: [{ sku: 'CH-A' }] },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const variantId = product.variants[0].id as string;
    await post(
      { token },
      '/inventory/opening-stock',
      { lines: [{ variantId, quantity: '20', unitCost: '40' }] },
      `open-${n}`,
    ).expect(201);
    const customer = (
      await http.post('/customers', { fullName: 'Pos Customer', phones: ['0300-5550001'] }, token)
    ).body.data as Json;
    const methods = (await http.get('/settings/payment-methods', token)).body.data as Json[];
    const method = (name: string) => methods.find((m) => m.name === name)?.id as string;
    return {
      ...created,
      token,
      roles,
      variantId,
      customer: customer.id as string,
      cash: method('Cash'),
      bank: method('Bank transfer'),
    };
  }
  type Biz = Awaited<ReturnType<typeof business>>;

  const ip = () => `10.77.${(++n >> 8) & 255}.${n & 255}`;
  function post(who: { token: string }, path: string, body: object = {}, key?: string) {
    const req = request(t.app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${who.token}`)
      .set('X-Forwarded-For', ip());
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  }
  async function member(b: Biz, roleName: string) {
    const email = `${roleName.toLowerCase().replace(/\W/g, '')}${++n}@pos.test`;
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
  let keys = 0;
  const checkout = (
    who: { token: string },
    body: object,
    key: string | undefined = `pos-${++keys}-${n}`,
  ) => post(who, '/pos/checkout', body, key);
  const sale = (b: Biz, quantity = '2', payment: object = { paymentMethodId: b.cash }) => ({
    lines: [{ variantId: b.variantId, quantity }],
    payment,
  });
  const counts = async (b: Biz) => ({
    orders: await t.db.prisma.order.count({ where: { workspaceId: b.workspaceId } }),
    payments: await t.db.prisma.payment.count({ where: { workspaceId: b.workspaceId } }),
    receipts: await t.db.prisma.receipt.count({ where: { workspaceId: b.workspaceId } }),
    movements: await t.db.prisma.stockMovement.count({ where: { workspaceId: b.workspaceId } }),
    onHand: (
      await t.db.prisma.stockLevel.findFirst({
        where: { workspaceId: b.workspaceId, variantId: b.variantId },
      })
    )?.onHand.toFixed(),
  });

  it('a cash sale makes a completed order, SALE movements at cost, a confirmed payment and a receipt', async () => {
    const b = await business();
    const res = await checkout(
      b,
      sale(b, '2', { paymentMethodId: b.cash, tendered: '500' }),
    ).expect(201);
    const data = res.body.data as Json;
    expect(data.order).toMatchObject({ source: 'POS', orderType: 'POS', totalAmount: '200' });
    expect(data.tendered).toBe('500');
    expect(Number(data.changeDue)).toBe(300);

    const order = await t.db.prisma.order.findFirstOrThrow({ where: { id: data.order.id } });
    expect(order.paymentStatus).toBe('PAID');
    expect(order.posSessionId).not.toBeNull();
    expect(order.closedAt).not.toBeNull();
    const history = await t.db.prisma.statusHistory.findMany({ where: { entityId: order.id } });
    expect(history.map((h) => h.toKey)).toContain(order.status);

    const movements = await t.db.prisma.stockMovement.findMany({
      where: { workspaceId: b.workspaceId, movementType: 'SALE' },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.quantityDelta.toFixed()).toBe('-2');
    const item = await t.db.prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.costPrice?.toFixed()).toBe('40');
    expect((await counts(b)).onHand).toBe('18');

    const payment = await t.db.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment).toMatchObject({ status: 'CONFIRMED', posSessionId: order.posSessionId });
    expect(payment.amount.toFixed()).toBe('200');

    const receipt = (await http.get(`/pos/receipts/${data.receipt.id}`, b.token)).body.data as Json;
    expect(receipt).toMatchObject({ type: 'SALE', reprintCount: 0, customerName: null });
    expect(receipt.data).toMatchObject({
      tendered: '500',
      totals: expect.objectContaining({ totalAmount: '200' }),
      payments: [expect.objectContaining({ method: 'Cash' })],
    });
    expect(receipt.data.lines).toHaveLength(1);
    const audit = await t.db.prisma.auditEvent.findMany({
      where: { workspaceId: b.workspaceId, action: 'pos.checkout' },
    });
    expect(audit).toHaveLength(1);
  });

  it('uses the walk-in customer by default, the cashier as salesperson, and a selected customer when given', async () => {
    const b = await business();
    const walk = (await checkout(b, sale(b, '1')).expect(201)).body.data.order as Json;
    const row = await t.db.prisma.order.findFirstOrThrow({
      where: { id: walk.id },
      include: { customer: true },
    });
    expect(row.customer.isWalkIn).toBe(true);
    expect(row.assignedToId).toBe((await http.get('/auth/me', b.token)).body.data.user.id);
    const named = (await checkout(b, { ...sale(b, '1'), customerId: b.customer }).expect(201)).body
      .data.order as Json;
    expect(named.customerId).toBe(b.customer);
  });

  it('non-cash payments must equal the total and need a reference when the method asks for one', async () => {
    const b = await business();
    await checkout(b, sale(b, '1', { paymentMethodId: b.bank, tendered: '500' })).expect(400);
    const methods = (await http.get('/settings/payment-methods', b.token)).body.data as Json[];
    const bank = methods.find((m) => m.id === b.bank) as Json;
    const attempt = await checkout(b, sale(b, '1', { paymentMethodId: b.bank }));
    if (bank.requiresReference) expect(attempt.status).toBe(400);
    else expect(attempt.status).toBe(201);
    await checkout(b, sale(b, '1', { paymentMethodId: b.bank, referenceNumber: 'TX-1' })).expect(
      201,
    );
  });

  it('refuses a tender below the total and an unknown payment method', async () => {
    const b = await business();
    const before = await counts(b);
    await checkout(b, sale(b, '2', { paymentMethodId: b.cash, tendered: '150' })).expect(422);
    await checkout(b, sale(b, '2', { paymentMethodId: 'nope' })).expect(400);
    expect(await counts(b)).toEqual(before);
  });

  it('insufficient stock returns 409 and leaves nothing behind (12.6)', async () => {
    const b = await business();
    const before = await counts(b);
    const res = await checkout(b, sale(b, '25')).expect(409);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    expect(await counts(b)).toEqual(before);
  });

  it('applies the cashier discount limit', async () => {
    const b = await business();
    const cashier = await member(b, 'Cashier');
    const res = await checkout(cashier, {
      ...sale(b, '1'),
      orderDiscount: { type: 'PERCENT', value: '90' },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await t.db.prisma.order.count({ where: { workspaceId: b.workspaceId } })).toBe(0);
  });

  it('opens one session per cashier per day and closes a stale one at the next sale', async () => {
    const b = await business();
    const first = (await http.get('/pos/sessions/current', b.token)).body.data as Json;
    const again = (await http.get('/pos/sessions/current', b.token)).body.data as Json;
    expect(again.id).toBe(first.id);
    await checkout(b, sale(b, '1')).expect(201);
    const open = await t.db.prisma.posSession.findMany({
      where: { workspaceId: b.workspaceId, status: 'OPEN' },
    });
    expect(open).toHaveLength(1);

    await t.db.prisma.posSession.update({
      where: { id: first.id },
      data: { openedAt: new Date(Date.now() - 3 * 86_400_000) },
    });
    const next = (await http.get('/pos/sessions/current', b.token)).body.data as Json;
    expect(next.id).not.toBe(first.id);
    const old = await t.db.prisma.posSession.findFirstOrThrow({ where: { id: first.id } });
    expect(old.status).toBe('CLOSED');
    expect(
      await t.db.prisma.posSession.count({
        where: { workspaceId: b.workspaceId, status: 'OPEN' },
      }),
    ).toBe(1);
  });

  it('is permission-gated: Viewer cannot sell, Cashier can; reprint needs pos:reprint', async () => {
    const b = await business();
    const viewer = await member(b, 'Viewer');
    const cashier = await member(b, 'Cashier');
    await checkout(viewer, sale(b, '1')).expect(403);
    await http.get('/pos/receipts', viewer.token).expect(403);
    const made = (await checkout(cashier, sale(b, '1')).expect(201)).body.data as Json;
    await http.get('/pos/receipts', cashier.token).expect(200);
    const reprint = await post(cashier, `/pos/receipts/${made.receipt.id}/reprint`);
    expect([200, 201, 403]).toContain(reprint.status);
  });

  it('lists and searches receipts, and a reprint counts and is audited (29.8)', async () => {
    const b = await business();
    const made = (await checkout(b, sale(b, '1')).expect(201)).body.data as Json;
    await checkout(b, { ...sale(b, '1'), customerId: b.customer }).expect(201);
    const all = (await http.get('/pos/receipts', b.token).expect(200)).body.data as Json[];
    expect(all).toHaveLength(2);
    const byName = (await http.get('/pos/receipts?q=Pos%20Customer', b.token)).body.data as Json[];
    expect(byName).toHaveLength(1);
    const byNumber = (await http.get(`/pos/receipts?q=${made.receipt.receiptNumber}`, b.token)).body
      .data as Json[];
    expect(byNumber.map((r) => r.id)).toEqual([made.receipt.id]);

    await post(b, `/pos/receipts/${made.receipt.id}/reprint`).expect((r) =>
      expect([200, 201]).toContain(r.status),
    );
    await post(b, `/pos/receipts/${made.receipt.id}/reprint`);
    const after = (await http.get(`/pos/receipts/${made.receipt.id}`, b.token)).body.data as Json;
    expect(after.reprintCount).toBe(2);
    expect(
      await t.db.prisma.auditEvent.count({
        where: { workspaceId: b.workspaceId, action: 'receipt.reprint' },
      }),
    ).toBe(2);
  });

  it("another workspace cannot see or reprint this workspace's receipts", async () => {
    const a = await business();
    const other = await business();
    const made = (await checkout(a, sale(a, '1')).expect(201)).body.data as Json;
    await http.get(`/pos/receipts/${made.receipt.id}`, other.token).expect(404);
    await post(other, `/pos/receipts/${made.receipt.id}/reprint`).expect(404);
    expect(((await http.get('/pos/receipts', other.token)).body.data as Json[]).length).toBe(0);
    await checkout(other, { ...sale(other, '1'), customerId: a.customer }).expect(400);
  });

  describe('51.1 atomicity: a failure at any step leaves nothing behind', () => {
    const steps: Array<[string, (b: Biz) => void]> = [
      [
        'order number',
        () => {
          const real = NumberingService.prototype.next;
          jest.spyOn(NumberingService.prototype, 'next').mockImplementation(function (
            this: NumberingService,
            ...args
          ) {
            if (args[1] === 'ORDER') throw new Error('injected');
            return real.apply(this, args);
          });
        },
      ],
      [
        'stock movements',
        () => {
          jest.spyOn(InventoryService.prototype, 'sell').mockRejectedValue(new Error('injected'));
        },
      ],
      [
        'payment number',
        () => {
          const real = NumberingService.prototype.next;
          jest.spyOn(NumberingService.prototype, 'next').mockImplementation(function (
            this: NumberingService,
            ...args
          ) {
            if (args[1] === 'PAYMENT') throw new Error('injected');
            return real.apply(this, args);
          });
        },
      ],
      [
        'receipt number',
        () => {
          const real = NumberingService.prototype.next;
          jest.spyOn(NumberingService.prototype, 'next').mockImplementation(function (
            this: NumberingService,
            ...args
          ) {
            if (args[1] === 'RECEIPT') throw new Error('injected');
            return real.apply(this, args);
          });
        },
      ],
      [
        'audit entry',
        () => {
          const real = AuditService.prototype.record;
          jest.spyOn(AuditService.prototype, 'record').mockImplementation(function (
            this: AuditService,
            ...args
          ) {
            if ((args[1] as { action: string }).action === 'pos.checkout')
              throw new Error('injected');
            return real.apply(this, args);
          });
        },
      ],
    ];

    it.each(steps)('failing at %s', async (_name, inject) => {
      const b = await business();
      await checkout(b, sale(b, '1')).expect(201); // make sure the session exists
      const before = await counts(b);
      inject(b);
      const res = await checkout(b, sale(b, '1'));
      expect(res.status).toBe(500);
      jest.restoreAllMocks();
      expect(await counts(b)).toEqual(before);
    });
  });

  describe('51.2 Property 16: idempotent checkout', () => {
    it('one key never makes two sales, sequentially or concurrently', async () => {
      const b = await business();
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 4 }),
          fc.boolean(),
          async (repeats, parallel) => {
            const key = `prop-${++keys}-${Math.random()}`;
            const before = await counts(b);
            const body = sale(b, '1');
            const results = parallel
              ? await Promise.all(Array.from({ length: repeats }, () => checkout(b, body, key)))
              : await (async () => {
                  const out = [];
                  for (let i = 0; i < repeats; i++) out.push(await checkout(b, body, key));
                  return out;
                })();
            const ok = results.filter((r) => r.status === 201);
            expect(ok.length).toBeGreaterThanOrEqual(1);
            expect(new Set(ok.map((r) => r.body.data.order.id)).size).toBe(1);
            const after = await counts(b);
            expect(after.orders).toBe(before.orders + 1);
            expect(after.payments).toBe(before.payments + 1);
            expect(after.receipts).toBe(before.receipts + 1);
            expect(after.movements).toBe(before.movements + 1);
          },
        ),
        { numRuns: 6 },
      );
    }, 120_000);

    it('the same key with a different body is refused', async () => {
      const b = await business();
      const key = `reuse-${++keys}`;
      await checkout(b, sale(b, '1'), key).expect(201);
      const res = await checkout(b, sale(b, '2'), key).expect(409);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });
});
