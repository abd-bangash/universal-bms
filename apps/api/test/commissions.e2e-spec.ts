import request from 'supertest';
import { CommissionsService } from '../src/modules/commissions/commissions.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { runWithWorkspace } from './helpers/context';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Commissions (real PostgreSQL)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;
  let keys = 0;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
  }, 90_000);
  afterAll(() => t.close());

  async function business(trigger?: 'COMPLETED' | 'CONFIRMED' | 'DELIVERED') {
    const email = `owner${++n}@com.test`;
    const created = await t.app.get(TenantsService).createWorkspace({
      name: `Com ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'Olivia', lastName: 'Owner', password: 'owner-password-1' },
      currency: 'PKR',
      country: 'PK',
    });
    await runWithWorkspace(t.app, created.workspaceId, () =>
      t.app.get(SettingsService).update({
        sales: { requiredDepositPercent: 0 },
        ...(trigger ? { commission: { triggerSystemRole: trigger } } : {}),
      }),
    );
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const roles = (await http.get('/roles', token)).body.data as Json[];
    const product = (
      await http
        .post(
          '/catalog/products',
          {
            type: 'NON_STOCKABLE',
            code: 'SOFA',
            name: 'Sofa',
            basePrice: '1000.00',
            variants: [{ sku: 'SOFA-A' }],
          },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const customer = (
      await http.post('/customers', { fullName: 'Sana Malik', phones: ['0300-1234567'] }, token)
    ).body.data as Json;
    const me = (await http.get('/auth/me', token)).body.data;
    const methods = (await http.get('/settings/payment-methods', token)).body.data as Json[];
    return {
      ...created,
      token,
      roles,
      customer: customer.id as string,
      productId: product.id as string,
      variantId: product.variants[0].id as string,
      ownerId: me.user.id as string,
      cash: methods.find((m) => m.name === 'Cash')?.id as string,
    };
  }
  type Biz = Awaited<ReturnType<typeof business>>;

  async function member(b: Biz, roleName: string) {
    const email = `${roleName.toLowerCase().replace(/\W/g, '')}${++n}@com.test`;
    const role = b.roles.find((r) => r.name === roleName) as Json;
    const invite = await http
      .post('/users/invite', { email, roleIds: [role.id] }, b.token)
      .expect(201);
    await http
      .post('/auth/invite/accept', {
        token: invite.body.data.token,
        password: 'member-password-1',
        firstName: roleName,
        lastName: `P${n}`,
      })
      .expect(200);
    const token = (
      await http.post('/auth/login', { email, password: 'member-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const me = (await http.get('/auth/me', token)).body.data;
    return { token, userId: me.user.id as string };
  }

  const send = (
    method: 'post' | 'put' | 'patch',
    who: { token: string },
    path: string,
    body: object = {},
    key?: string,
  ) => {
    const agent = request(t.app.getHttpServer());
    const req = agent[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${who.token}`)
      .set('X-Forwarded-For', `10.44.${(++n >> 8) & 255}.${n & 255}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const post = (who: { token: string }, path: string, body: object = {}, key?: string) =>
    send('post', who, path, body, key);
  const setPercent = (b: Biz, userId: string, percent: string) =>
    send('put', b, `/staff/${userId}/commission`, { percent });
  /** An order of 2 sofas (2000), assigned to `seller`, driven by the owner up to the given status. */
  async function order(
    b: Biz,
    seller: { token: string },
    upTo: 'confirmed' | 'completed',
    lines?: object[],
  ) {
    const o = (
      await post(
        seller,
        '/orders',
        { customerId: b.customer, lines: lines ?? [{ variantId: b.variantId, quantity: '2' }] },
        `k-${++keys}`,
      ).expect(201)
    ).body.data as Json;
    const to = (key: string) => post(b, `/orders/${o.id}/status`, { status: key }).expect(200);
    await to('confirmed');
    if (upTo === 'completed') {
      for (const s of ['in_production', 'ready', 'delivered', 'completed']) await to(s);
    }
    return o;
  }
  const statement = async (who: { token: string }, query = '') =>
    (await http.get(`/commissions${query}`, who.token).expect(200)).body.data as Json[];

  describe('calculation (14.2, 41.4)', () => {
    it('completing an order creates a pending commission for the salesperson from their percentage', async () => {
      const b = await business();
      const sales = await member(b, 'Salesperson');
      await setPercent(b, sales.userId, '10').expect(200);
      const o = await order(b, sales, 'confirmed');
      expect(await statement(b)).toEqual([]); // not yet: the trigger is Completed
      for (const s of ['in_production', 'ready', 'delivered', 'completed']) {
        await post(b, `/orders/${o.id}/status`, { status: s }).expect(200);
      }
      const rows = await statement(b);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        orderId: o.id,
        salespersonId: sales.userId,
        status: 'PENDING',
        calculationBase: '2000',
        sharePercent: '100',
        amount: '200',
        ruleName: 'Staff commission',
      });
      expect(rows[0].orderNumber).toBe(o.orderNumber);
    });

    it('calculating the same order again changes nothing, and a different trigger role is honoured (14.2)', async () => {
      const b = await business('CONFIRMED');
      const sales = await member(b, 'Salesperson');
      await setPercent(b, sales.userId, '5').expect(200);
      const o = await order(b, sales, 'confirmed');
      expect(await statement(b)).toHaveLength(1);
      const created = await runWithWorkspace(t.app, b.workspaceId, () =>
        t.app.get(CommissionsService).calculateForOrder(o.id),
      );
      expect(created).toBe(0);
      expect(await statement(b)).toHaveLength(1);
      expect(
        await t.db.prisma.auditEvent.count({
          where: { workspaceId: b.workspaceId, action: 'commission.calculate' },
        }),
      ).toBe(1);
    });

    it('lines with no matching rule make no commission; no rules make none at all', async () => {
      const b = await business('CONFIRMED');
      const sales = await member(b, 'Salesperson');
      await order(b, sales, 'confirmed');
      expect(await statement(b)).toEqual([]);
      await send('post', b, '/commissions/rules', {
        name: 'Other product only',
        calcType: 'PERCENTAGE',
        rate: '10',
        scope: 'PRODUCT',
        scopeId: (
          await t.db.prisma.product.findFirstOrThrow({ where: { workspaceId: b.workspaceId } })
        ).id,
      }).expect(201);
      await order(b, sales, 'confirmed', [
        { kind: 'CUSTOM', name: 'Wardrobe', quantity: '1', unitPrice: '500' },
      ]);
      expect(await statement(b)).toEqual([]); // the custom line is not that product
    });

    it("the salesperson's own rule beats a product rule, and a product rule beats the general one (41.4)", async () => {
      const b = await business('CONFIRMED');
      const sales = await member(b, 'Salesperson');
      const other = await member(b, 'Salesperson');
      await send('post', b, '/commissions/rules', {
        name: 'General',
        calcType: 'PERCENTAGE',
        rate: '2',
      }).expect(201);
      await send('post', b, '/commissions/rules', {
        name: 'Sofas',
        calcType: 'PERCENTAGE',
        rate: '4',
        scope: 'PRODUCT',
        scopeId: b.productId,
      }).expect(201);
      await setPercent(b, sales.userId, '10').expect(200);
      await order(b, sales, 'confirmed');
      await order(b, other, 'confirmed');
      const rows = await statement(b);
      const amountOf = (who: string) => rows.find((r) => r.salespersonId === who)?.amount;
      expect(amountOf(sales.userId)).toBe('200'); // 10% of 2000: their own rule
      expect(amountOf(other.userId)).toBe('80'); // 4% of 2000: the product rule
    });

    it('a fixed amount per unit and per order, and shares between two salespeople (14.1, 41.3)', async () => {
      const b = await business('CONFIRMED');
      const sales = await member(b, 'Salesperson');
      await send('post', b, '/commissions/rules', {
        name: 'Per unit',
        calcType: 'FIXED_PER_UNIT',
        rate: '25',
        scope: 'ORDER_TYPE',
        scopeId: 'STANDARD',
      }).expect(201);
      const o = await order(b, sales, 'confirmed');
      expect((await statement(b))[0]).toMatchObject({ amount: '50' }); // 2 units × 25
      expect(o.id).toBeTruthy();
      // two salespeople share an order 70/30
      const second = await member(b, 'Salesperson');
      const shared = (
        await post(
          b,
          '/orders',
          {
            customerId: b.customer,
            lines: [{ variantId: b.variantId, quantity: '4' }],
            assignedToId: sales.userId,
          },
          `k-${++keys}`,
        ).expect(201)
      ).body.data as Json;
      await t.db.prisma.orderSalesperson.deleteMany({ where: { orderId: shared.id } });
      await t.db.prisma.orderSalesperson.createMany({
        data: [
          {
            workspaceId: b.workspaceId,
            orderId: shared.id,
            userId: sales.userId,
            sharePercent: '70',
          },
          {
            workspaceId: b.workspaceId,
            orderId: shared.id,
            userId: second.userId,
            sharePercent: '30',
          },
        ],
      });
      await post(b, `/orders/${shared.id}/status`, { status: 'confirmed' }).expect(200);
      const rows = (await statement(b, `?orderId=${shared.id}`)).map((r) => [
        r.salespersonId,
        r.amount,
      ]);
      expect(rows).toEqual(
        expect.arrayContaining([
          [sales.userId, '70'], // 4 × 25 × 70%
          [second.userId, '30'],
        ]),
      );
    });

    it('a counter sale earns its commission straight away (12.9)', async () => {
      const b = await business();
      await setPercent(b, b.ownerId, '3').expect(200);
      const res = await post(
        b,
        '/pos/checkout',
        {
          lines: [{ variantId: b.variantId, quantity: '1' }],
          payment: { paymentMethodId: b.cash },
        },
        `pos-${++keys}`,
      ).expect(201);
      const rows = await statement(b);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        orderId: res.body.data.order.id,
        salespersonId: b.ownerId,
        amount: '30',
        status: 'PENDING',
      });
    });

    it('nothing is calculated when the commissions module is switched off', async () => {
      const b = await business('CONFIRMED');
      const sales = await member(b, 'Salesperson');
      await setPercent(b, sales.userId, '10').expect(200);
      await runWithWorkspace(t.app, b.workspaceId, () =>
        t.app.get(SettingsService).update({ modules: { commissions: false } }),
      );
      await order(b, sales, 'confirmed');
      expect(await statement(b)).toEqual([]);
    });
  });

  describe('reversal (14.6)', () => {
    it('cancelling an order reverses its commissions in every status but rejected', async () => {
      const b = await business('CONFIRMED');
      const sales = await member(b, 'Salesperson');
      await send('post', b, '/commissions/rules', {
        name: 'A',
        calcType: 'PERCENTAGE',
        rate: '5',
        salespersonId: sales.userId,
      }).expect(201);
      // two lines → two commission rows to put in different states
      const o = await order(b, sales, 'confirmed', [
        { variantId: b.variantId, quantity: '1' },
        { kind: 'CUSTOM', name: 'Extra', quantity: '1', unitPrice: '500' },
      ]);
      const [first, second] = await statement(b, `?orderId=${o.id}`);
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      await post(b, `/commissions/${first.id}/approve`).expect(200);
      await post(b, `/commissions/${first.id}/pay`, { method: 'Cash' }).expect(200);
      await post(b, `/commissions/${second.id}/reject`, { reason: 'Disputed' }).expect(200);
      await post(b, `/orders/${o.id}/status`, {
        status: 'cancelled',
        reason: 'Customer left',
      }).expect(200);
      const after = await statement(b, `?orderId=${o.id}`);
      expect(after.find((r) => r.id === first.id)?.status).toBe('REVERSED'); // even though it was paid
      expect(after.find((r) => r.id === second.id)?.status).toBe('REJECTED');
      expect(
        await t.db.prisma.auditEvent.count({
          where: { workspaceId: b.workspaceId, action: 'commission.reverse', entityId: o.id },
        }),
      ).toBe(1);
    });

    it('a pending commission is reversed, and a reversed one cannot be approved', async () => {
      const b = await business('CONFIRMED');
      const sales = await member(b, 'Salesperson');
      await setPercent(b, sales.userId, '10').expect(200);
      const o = await order(b, sales, 'confirmed');
      const [row] = await statement(b);
      await post(b, `/orders/${o.id}/status`, {
        status: 'cancelled',
        reason: 'Changed mind',
      }).expect(200);
      expect((await statement(b))[0].status).toBe('REVERSED');
      await post(b, `/commissions/${row.id}/approve`).expect(422);
    });
  });

  describe('approve, reject and pay (14.4, 14.5)', () => {
    async function pending(b: Biz) {
      const sales = await member(b, 'Salesperson');
      await setPercent(b, sales.userId, '10').expect(200);
      await order(b, sales, 'confirmed');
      return { sales, row: (await statement(b))[0] as Json };
    }

    it('moves pending to approved to paid, recording who, when and how', async () => {
      const b = await business('CONFIRMED');
      const { row } = await pending(b);
      await post(b, `/commissions/${row.id}/pay`, { method: 'Cash' }).expect(422); // not approved yet
      const approved = (await post(b, `/commissions/${row.id}/approve`).expect(200)).body.data;
      expect(approved).toMatchObject({ status: 'APPROVED', approvedById: b.ownerId });
      await post(b, `/commissions/${row.id}/approve`).expect(422);
      await post(b, `/commissions/${row.id}/reject`).expect(422);
      const paid = (
        await post(b, `/commissions/${row.id}/pay`, {
          method: 'Bank transfer',
          paidAt: '2030-01-15T00:00:00.000Z',
        }).expect(200)
      ).body.data;
      expect(paid).toMatchObject({
        status: 'PAID',
        paidMethod: 'Bank transfer',
        paidAt: '2030-01-15T00:00:00.000Z',
      });
      await post(b, `/commissions/${row.id}/pay`, { method: 'Cash' }).expect(422);
      const actions = (
        await t.db.prisma.auditEvent.findMany({
          where: { workspaceId: b.workspaceId, entityId: row.id },
          orderBy: { createdAt: 'asc' },
        })
      ).map((e) => e.action);
      expect(actions).toEqual(['commission.approve', 'commission.pay']);
    });

    it('a rejected commission stays rejected and cannot be paid', async () => {
      const b = await business('CONFIRMED');
      const { row } = await pending(b);
      const rejected = (
        await post(b, `/commissions/${row.id}/reject`, { reason: 'Wrong order' }).expect(200)
      ).body.data;
      expect(rejected).toMatchObject({ status: 'REJECTED', note: 'Wrong order' });
      await post(b, `/commissions/${row.id}/approve`).expect(422);
      await post(b, `/commissions/${row.id}/pay`, { method: 'Cash' }).expect(422);
    });

    it('approval needs commission:approve, payment needs commission:pay', async () => {
      const b = await business('CONFIRMED');
      const { sales, row } = await pending(b);
      await post(sales, `/commissions/${row.id}/approve`).expect(403);
      const accounts = await member(b, 'Account Staff'); // may pay and see all, not approve
      await post(accounts, `/commissions/${row.id}/approve`).expect(403);
      await post(b, `/commissions/${row.id}/approve`).expect(200);
      await post(sales, `/commissions/${row.id}/pay`, { method: 'Cash' }).expect(403);
      await post(accounts, `/commissions/${row.id}/pay`, { method: 'Cash' }).expect(200);
    });

    it('two approvals at once decide it once', async () => {
      const b = await business('CONFIRMED');
      const { row } = await pending(b);
      const results = await Promise.all([
        post(b, `/commissions/${row.id}/approve`),
        post(b, `/commissions/${row.id}/approve`),
        post(b, `/commissions/${row.id}/reject`),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    });
  });

  describe('who sees what (14.7, 41.7)', () => {
    it("a salesperson sees only their own commissions and performance; others' are refused", async () => {
      const b = await business('CONFIRMED');
      const ann = await member(b, 'Salesperson');
      const bob = await member(b, 'Salesperson');
      await setPercent(b, ann.userId, '10').expect(200);
      await setPercent(b, bob.userId, '20').expect(200);
      await order(b, ann, 'confirmed');
      await order(b, bob, 'confirmed');
      expect((await statement(ann)).map((r) => r.salespersonId)).toEqual([ann.userId]);
      expect(await statement(ann, `?salespersonId=${bob.userId}`)).toEqual([]);
      expect(await statement(b)).toHaveLength(2);
      expect(await statement(b, `?salespersonId=${bob.userId}`)).toHaveLength(1);
      await http.get(`/staff/${ann.userId}/performance`, ann.token).expect(200);
      await http.get(`/staff/${bob.userId}/performance`, ann.token).expect(404);
      await http.get(`/staff/${bob.userId}/performance`, b.token).expect(200);
    });

    it('commission setup needs commission:configure and sees only its own workspace', async () => {
      const a = await business();
      const other = await business();
      const sales = await member(a, 'Salesperson');
      await send('put', sales, `/staff/${sales.userId}/commission`, { percent: '50' }).expect(403);
      await http.get('/commissions/rules', sales.token).expect(403);
      await setPercent(other, sales.userId, '5').expect(404);
      await http.get(`/staff/${sales.userId}/performance`, other.token).expect(404);
      await send('post', other, '/commissions/rules', {
        name: 'x',
        calcType: 'PERCENTAGE',
        rate: '1',
        salespersonId: sales.userId,
      }).expect(400);
    });

    it('filters by status and date', async () => {
      const b = await business('CONFIRMED');
      const sales = await member(b, 'Salesperson');
      await setPercent(b, sales.userId, '10').expect(200);
      await order(b, sales, 'confirmed');
      await order(b, sales, 'confirmed');
      const [first] = await statement(b);
      await post(b, `/commissions/${first.id}/approve`).expect(200);
      expect(await statement(b, '?status=APPROVED')).toHaveLength(1);
      expect(await statement(b, '?status=PENDING')).toHaveLength(1);
      expect(await statement(b, '?from=2999-01-01T00:00:00.000Z')).toEqual([]);
      expect(await statement(b, '?to=2000-01-01T00:00:00.000Z')).toEqual([]);
      expect(await statement(b, '?from=2000-01-01T00:00:00.000Z')).toHaveLength(2);
    });
  });

  describe('rules and staff percentage', () => {
    it('creates, edits and deactivates rules, checking what they point at (14.1)', async () => {
      const b = await business();
      const bad = await send('post', b, '/commissions/rules', {
        name: 'Bad',
        calcType: 'PERCENTAGE',
        rate: '150',
        scope: 'CATEGORY',
        scopeId: 'nope',
      }).expect(400);
      expect(Object.keys(bad.body.details)).toEqual(expect.arrayContaining(['rate', 'scopeId']));
      await send('post', b, '/commissions/rules', {
        name: 'No scope id',
        calcType: 'PERCENTAGE',
        rate: '1',
        scope: 'PRODUCT',
      }).expect(400);
      const rule = (
        await send('post', b, '/commissions/rules', {
          name: 'Sofas',
          calcType: 'PERCENTAGE',
          rate: '4',
          baseType: 'GROSS_SALES',
          scope: 'PRODUCT',
          scopeId: b.productId,
          priority: 2,
        }).expect(201)
      ).body.data as Json;
      expect(rule).toMatchObject({
        scope: 'PRODUCT',
        baseType: 'GROSS_SALES',
        priority: 2,
        active: true,
      });
      const edited = (
        await send('patch', b, `/commissions/rules/${rule.id}`, {
          rate: '6',
          active: false,
        }).expect(200)
      ).body.data;
      expect(edited).toMatchObject({ rate: '6', active: false });
      await send('patch', b, `/commissions/rules/${rule.id}`, { scope: 'ALL' }).expect(400); // still points at a product
      const listed = (await http.get('/commissions/rules', b.token)).body.data as Json[];
      expect(listed.map((r) => r.id)).toContain(rule.id);
      expect(
        await t.db.prisma.auditEvent.count({
          where: { workspaceId: b.workspaceId, action: { startsWith: 'commission.rule_' } },
        }),
      ).toBe(2);
    });

    it('a changed rule does not rewrite commissions already calculated', async () => {
      const b = await business('CONFIRMED');
      const sales = await member(b, 'Salesperson');
      const rule = (
        await send('post', b, '/commissions/rules', {
          name: 'Original',
          calcType: 'PERCENTAGE',
          rate: '10',
        }).expect(201)
      ).body.data as Json;
      await order(b, sales, 'confirmed');
      await send('patch', b, `/commissions/rules/${rule.id}`, {
        rate: '50',
        name: 'Renamed',
      }).expect(200);
      expect((await statement(b))[0]).toMatchObject({ amount: '200', ruleName: 'Original' });
    });

    it('the staff percentage creates one rule, updates it, and 0 switches it off', async () => {
      const b = await business('CONFIRMED');
      const sales = await member(b, 'Salesperson');
      expect((await http.get(`/staff/${sales.userId}/commission`, b.token)).body.data).toEqual({
        percent: null,
        ruleId: null,
      });
      const first = (await setPercent(b, sales.userId, '7.5').expect(200)).body.data;
      expect(first.percent).toBe('7.5');
      const again = (await setPercent(b, sales.userId, '9').expect(200)).body.data;
      expect(again).toMatchObject({ percent: '9', ruleId: first.ruleId });
      expect(
        await t.db.prisma.commissionRule.count({ where: { salespersonId: sales.userId } }),
      ).toBe(1);
      await setPercent(b, sales.userId, '101').expect(400);
      await setPercent(b, sales.userId, '-1').expect(400);
      await setPercent(b, sales.userId, '0').expect(200);
      expect(
        (await http.get(`/staff/${sales.userId}/commission`, b.token)).body.data.percent,
      ).toBeNull();
      await order(b, sales, 'confirmed');
      expect(await statement(b)).toEqual([]);
    });
  });

  describe('performance (41.6)', () => {
    it('shows leads, conversion, sales and commissions for a salesperson', async () => {
      const b = await business('CONFIRMED');
      const sales = await member(b, 'Salesperson');
      await setPercent(b, sales.userId, '10').expect(200);
      for (const name of ['Lead One', 'Lead Two']) {
        await http
          .post(
            '/leads',
            { fullName: name, phone: `0300-${++n}00000`, assignedToId: sales.userId },
            b.token,
          )
          .expect(201);
      }
      const won = (await http.get('/leads', b.token)).body.data[0] as Json;
      await post(b, `/leads/${won.id}/stage`, { stage: 'won' }).expect(200);
      await order(b, sales, 'confirmed');
      const [row] = await statement(b);
      await post(b, `/commissions/${row.id}/approve`).expect(200);
      const perf = (await http.get(`/staff/${sales.userId}/performance`, sales.token)).body
        .data as Json;
      expect(perf).toMatchObject({
        leadsAssigned: 2,
        orders: 1,
        salesValue: '2000',
        averageOrderValue: '2000',
        commissionsPending: '0',
        commissionsApproved: '200',
        commissionsPaid: '0',
      });
      expect(perf).toMatchObject({ leadsWon: 1, conversionRate: '50' });
    });
  });

  describe('checkpoint 62: the whole life of a commission', () => {
    it('percentage set, an order and a counter sale earn commissions, both are approved and paid, a cancelled order is reversed', async () => {
      const b = await business(); // the trigger is Completed
      const seller = await member(b, 'Salesperson');
      await setPercent(b, seller.userId, '5').expect(200);

      const completed = await order(b, seller, 'completed');
      const sale = (
        await post(
          seller,
          '/pos/checkout',
          {
            lines: [{ variantId: b.variantId, quantity: '1' }],
            payment: { paymentMethodId: b.cash },
          },
          `pos-${++keys}`,
        ).expect(201)
      ).body.data;
      const rows = await statement(b);
      expect(rows.map((r) => [r.orderId, r.amount, r.status]).sort()).toEqual(
        [
          [completed.id, '100', 'PENDING'], // 5% of 2000
          [sale.order.id, '50', 'PENDING'], // 5% of 1000, straight away
        ].sort(),
      );

      for (const row of rows) {
        await post(b, `/commissions/${row.id}/approve`).expect(200);
        await post(b, `/commissions/${row.id}/pay`, { method: 'Bank transfer' }).expect(200);
      }
      expect((await statement(b)).every((r) => r.status === 'PAID')).toBe(true);
      const perf = (await http.get(`/staff/${seller.userId}/performance`, seller.token)).body.data;
      expect(perf).toMatchObject({ commissionsPaid: '150', commissionsPending: '0' });

      // a cancelled order has nothing to pay: its pending commission is reversed
      await runWithWorkspace(t.app, b.workspaceId, () =>
        t.app.get(SettingsService).update({ commission: { triggerSystemRole: 'CONFIRMED' } }),
      );
      const cancelled = await order(b, seller, 'confirmed');
      const mine = (await statement(seller, `?orderId=${cancelled.id}`))[0];
      expect(mine).toMatchObject({ status: 'PENDING', amount: '100' });
      await post(b, `/orders/${cancelled.id}/status`, {
        status: 'cancelled',
        reason: 'Customer left',
      }).expect(200);
      expect((await statement(seller, `?orderId=${cancelled.id}`))[0].status).toBe('REVERSED');
    });
  });
});
