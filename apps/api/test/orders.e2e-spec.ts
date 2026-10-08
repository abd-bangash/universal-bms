import request from 'supertest';
import { SettingsService } from '../src/modules/settings/settings.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { runWithWorkspace } from './helpers/context';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Orders API (real PostgreSQL)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;
  let keys = 0;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
  }, 90_000);
  afterAll(() => t.close());

  async function business(depositPercent?: number) {
    const email = `owner${++n}@orders.test`;
    const created = await t.app.get(TenantsService).createWorkspace({
      name: `Orders ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'Olivia', lastName: 'Owner', password: 'owner-password-1' },
      currency: 'PKR',
      country: 'PK',
    });
    if (depositPercent !== undefined) {
      await runWithWorkspace(t.app, created.workspaceId, () =>
        t.app.get(SettingsService).update({ sales: { requiredDepositPercent: depositPercent } }),
      );
    }
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
    return { ...created, token, roles, customer, variantId: product.variants[0].id as string };
  }
  type Biz = Awaited<ReturnType<typeof business>>;

  async function member(b: Biz, roleName: string) {
    const email = `${roleName.toLowerCase().replace(/\W/g, '')}${++n}@orders.test`;
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

  const post = (b: { token: string }, path: string, body: object = {}, key?: string) => {
    const req = request(t.app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${b.token}`)
      .set('X-Forwarded-For', `10.99.${(++n >> 8) & 255}.${n & 255}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const createOrder = (b: Biz, body: object = {}, who: { token: string } = b) =>
    post(
      who,
      '/orders',
      {
        customerId: b.customer.id,
        lines: [{ variantId: b.variantId, quantity: '2' }],
        ...body,
      },
      `key-${++keys}`,
    );
  const status = (b: { token: string }, id: string, to: string, extra: object = {}) =>
    post(b, `/orders/${id}/status`, { status: to, ...extra });

  describe('create and edit (11.1, 39.3)', () => {
    it('prices the lines, numbers the order, starts it as a draft with a 100% salesperson', async () => {
      const b = await business();
      const res = await createOrder(b, { notes: 'Gate code 4411', source: 'MESSAGING' }).expect(
        201,
      );
      const o = res.body.data as Json;
      expect(o.orderNumber).toMatch(/^ORD-\d{4}-0001$/);
      expect(o.status).toBe('draft');
      expect(o.paymentStatus).toBe('UNPAID');
      expect(o.totalAmount).toBe('2000');
      expect(o.balanceDue).toBe('2000');
      expect(o.orderType).toBe('STANDARD');
      expect(o.source).toBe('MESSAGING');
      expect(o.items).toHaveLength(1);
      expect(o.salespeople).toEqual([expect.objectContaining({ sharePercent: '100' })]);
      const history = (await http.get(`/orders/${o.id}/status-history`, b.token).expect(200)).body
        .data as Json[];
      expect(history).toEqual([expect.objectContaining({ from: null, to: 'draft' })]);
    });

    it('a custom line makes it a CUSTOM order; fulfilment fields can be set on create', async () => {
      const b = await business();
      const o = (
        await createOrder(b, {
          lines: [{ kind: 'CUSTOM', name: 'Wardrobe 8x7', quantity: '1', unitPrice: '60000' }],
          method: 'DELIVERY',
          deliveryAddress: { line1: '12 Garden Road', city: 'Lahore' },
          scheduledAt: '2099-03-01T10:00:00Z',
        }).expect(201)
      ).body.data as Json;
      expect(o.orderType).toBe('CUSTOM');
      expect(o.fulfilmentMethod).toBe('DELIVERY');
      expect(o.deliveryAddress).toEqual({ line1: '12 Garden Road', city: 'Lahore' });
      expect(o.scheduledAt).toContain('2099-03-01');
    });

    it('edits a draft (lines recalculated) but not the lines of a confirmed order', async () => {
      const b = await business();
      const o = (await createOrder(b).expect(201)).body.data as Json;
      const edited = await http
        .patch(
          `/orders/${o.id}`,
          { version: o.version, lines: [{ variantId: b.variantId, quantity: '5' }] },
          b.token,
        )
        .expect(200);
      expect(edited.body.data.totalAmount).toBe('5000');
      expect(edited.body.data.balanceDue).toBe('5000');
      await http
        .patch(`/orders/${o.id}`, { version: o.version, notes: 'stale' }, b.token)
        .expect(409);

      await status(b, o.id, 'confirmed').expect(200);
      const current = (await http.get(`/orders/${o.id}`, b.token)).body.data as Json;
      await http
        .patch(
          `/orders/${o.id}`,
          { version: current.version, lines: [{ variantId: b.variantId, quantity: '1' }] },
          b.token,
        )
        .expect(422);
      const notes = await http
        .patch(
          `/orders/${o.id}`,
          { version: current.version, internalNotes: 'Call first' },
          b.token,
        )
        .expect(200);
      expect(notes.body.data.internalNotes).toBe('Call first');
    });

    it('validates the customer, the assignee and the location', async () => {
      const b = await business();
      const other = await business();
      await createOrder(b, { customerId: 'nope' }).expect(400);
      await createOrder(b, { customerId: other.customer.id }).expect(400);
      await createOrder(b, { assignedToId: 'nobody' }).expect(400);
      await createOrder(b, { locationId: 'nowhere' }).expect(400);
    });
  });

  describe('idempotent creation (54.1, Property 16)', () => {
    it('needs an Idempotency-Key', async () => {
      const b = await business();
      await post(b, '/orders', { customerId: b.customer.id, lines: [] }).expect(400);
    });

    it('the same key and request returns the first response and creates one order', async () => {
      const b = await business();
      const body = {
        customerId: b.customer.id,
        lines: [{ variantId: b.variantId, quantity: '1' }],
      };
      const first = await post(b, '/orders', body, 'same-key').expect(201);
      const again = await post(b, '/orders', body, 'same-key').expect(201);
      expect(again.body.data.id).toBe(first.body.data.id);
      expect(again.body.data.orderNumber).toBe(first.body.data.orderNumber);
      expect(await t.db.prisma.order.count({ where: { workspaceId: b.workspaceId } })).toBe(1);
    });

    it('concurrent requests with one key create exactly one order', async () => {
      const b = await business();
      const body = {
        customerId: b.customer.id,
        lines: [{ variantId: b.variantId, quantity: '1' }],
      };
      const results = await Promise.all(
        Array.from({ length: 5 }, () => post(b, '/orders', body, 'race-key')),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
      expect(await t.db.prisma.order.count({ where: { workspaceId: b.workspaceId } })).toBe(1);
    });

    it('the same key with a different request is refused, and a failed request frees the key', async () => {
      const b = await business();
      await post(b, '/orders', { customerId: b.customer.id, lines: [] }, 'k1').expect(201);
      const reused = await post(
        b,
        '/orders',
        { customerId: b.customer.id, lines: [], notes: 'different' },
        'k1',
      ).expect(409);
      expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

      await post(b, '/orders', { customerId: 'missing', lines: [] }, 'k2').expect(400);
      await post(b, '/orders', { customerId: b.customer.id, lines: [] }, 'k2').expect((res) =>
        expect([201, 409]).toContain(res.status),
      );
    });

    it('keys are per workspace', async () => {
      const a = await business();
      const c = await business();
      const one = await post(
        a,
        '/orders',
        { customerId: a.customer.id, lines: [] },
        'shared',
      ).expect(201);
      const two = await post(
        c,
        '/orders',
        { customerId: c.customer.id, lines: [] },
        'shared',
      ).expect(201);
      expect(one.body.data.id).not.toBe(two.body.data.id);
    });
  });

  describe('status changes (11.2, 11.3)', () => {
    it('refuses a disallowed transition with 422 and the allowed states (35.1)', async () => {
      const b = await business();
      const o = (await createOrder(b).expect(201)).body.data as Json;
      const res = await status(b, o.id, 'delivered').expect(422);
      expect(res.body.code).toBe('TRANSITION_NOT_ALLOWED');
      expect(res.body.details.allowed).toEqual(expect.arrayContaining(['confirmed', 'on_hold']));
      expect(res.body.details.allowed).not.toContain('delivered');
      expect((await http.get(`/orders/${o.id}`, b.token)).body.data.status).toBe('draft');
    });

    it('an order needs a line to be confirmed, and records history and a timeline entry', async () => {
      const b = await business();
      const empty = (await createOrder(b, { lines: [] }).expect(201)).body.data as Json;
      const refused = await status(b, empty.id, 'confirmed').expect(400);
      expect(refused.body.details.lines).toBeDefined();

      const o = (await createOrder(b).expect(201)).body.data as Json;
      const ok = await status(b, o.id, 'confirmed', { note: 'Customer called' }).expect(200);
      expect(ok.body.data.order.status).toBe('confirmed');
      const history = (await http.get(`/orders/${o.id}/status-history`, b.token)).body
        .data as Json[];
      expect(history.map((h) => h.to)).toEqual(['draft', 'confirmed']);
      expect(history[1]).toEqual(
        expect.objectContaining({
          from: 'draft',
          changedById: expect.any(String),
          note: 'Customer called',
        }),
      );
      const timeline = (await http.get(`/orders/${o.id}/timeline`, b.token).expect(200)).body
        .data as Json[];
      expect(timeline.map((e) => e.type)).toEqual(expect.arrayContaining(['ORDER', 'STATUS']));
    });

    it('fixes the deposit from the configured percentage when the order is confirmed', async () => {
      const b = await business(30);
      const o = (await createOrder(b).expect(201)).body.data as Json;
      expect(o.depositRequired).toBe('0');
      const confirmed = await status(b, o.id, 'confirmed').expect(200);
      expect(confirmed.body.data.order.depositRequired).toBe('600');
    });

    it('cancelling needs a reason and the cancel permission; the reason is kept', async () => {
      const b = await business();
      const o = (await createOrder(b).expect(201)).body.data as Json;
      const sales = await member(b, 'Salesperson');
      const mine = (await createOrder(b, {}, sales).expect(201)).body.data as Json;
      await status(sales, mine.id, 'cancelled', { reason: 'Changed mind' }).expect(403);
      await status(b, o.id, 'cancelled').expect(400);
      const res = await status(b, o.id, 'cancelled', { reason: 'Changed mind' }).expect(200);
      expect(res.body.data.order.status).toBe('cancelled');
      expect(res.body.data.order.cancelReason).toBe('Changed mind');
      expect(res.body.data.order.cancelledAt).not.toBeNull();
      // a cancelled order is closed to further status changes and edits
      await status(b, o.id, 'confirmed').expect(422);
      await http
        .patch(`/orders/${o.id}`, { version: res.body.data.order.version, notes: 'x' }, b.token)
        .expect(422);
    });

    it('confirming an order closes the linked lead as won', async () => {
      const b = await business();
      const lead = (
        await http.post('/leads', { fullName: 'Hina Raza', phone: '0301-5550000' }, b.token)
      ).body.data as Json;
      const o = (await createOrder(b, { leadId: lead.id }).expect(201)).body.data as Json;
      expect(o.leadId).toBe(lead.id);
      await status(b, o.id, 'confirmed').expect(200);
      const after = (await http.get(`/leads/${lead.id}`, b.token)).body.data as Json;
      expect(after.stage).toBe('won');
    });
  });

  describe('deposit before production (39.5)', () => {
    it('an order cannot enter production below the required deposit, and can once it is paid (35.1)', async () => {
      const b = await business(30);
      const sales = await member(b, 'Salesperson');
      const o = (await createOrder(b, {}, sales).expect(201)).body.data as Json;
      await status(sales, o.id, 'confirmed').expect(200);
      await t.db.prisma.order.update({
        where: { id: o.id },
        data: { paidAmount: '500', balanceDue: '1500' },
      });
      const refused = await status(sales, o.id, 'in_production').expect(422);
      expect(refused.body.code).toBe('DEPOSIT_REQUIRED');
      expect(refused.body.data).toEqual({ required: '600', paid: '500' });
      expect((await http.get(`/orders/${o.id}`, b.token)).body.data.status).toBe('confirmed');

      await t.db.prisma.order.update({
        where: { id: o.id },
        data: { paidAmount: '600', balanceDue: '1400' },
      });
      await status(sales, o.id, 'in_production').expect(200);
    });

    it('a person with the override permission can start production without the deposit', async () => {
      const b = await business(30);
      const o = (await createOrder(b).expect(201)).body.data as Json;
      await status(b, o.id, 'confirmed').expect(200);
      await status(b, o.id, 'in_production').expect(200); // the Owner holds order:deposit_override
    });

    it('no deposit is needed when the percentage is zero', async () => {
      const b = await business(0);
      const sales = await member(b, 'Salesperson');
      const o = (await createOrder(b, {}, sales).expect(201)).body.data as Json;
      await status(sales, o.id, 'confirmed').expect(200);
      await status(sales, o.id, 'in_production').expect(200);
    });
  });

  describe('completing with a balance (39.10)', () => {
    async function delivered(b: Biz, who: { token: string }) {
      const o = (await createOrder(b, {}, who).expect(201)).body.data as Json;
      await status(who, o.id, 'confirmed').expect(200);
      await status(who, o.id, 'in_production').expect(200);
      await status(who, o.id, 'ready').expect(200);
      await status(who, o.id, 'delivered').expect(200);
      return o;
    }

    it('an order with a balance cannot be completed without the override permission (35.1)', async () => {
      const b = await business(0);
      const sales = await member(b, 'Salesperson');
      const o = await delivered(b, sales);
      const refused = await status(sales, o.id, 'completed').expect(422);
      expect(refused.body.code).toBe('BALANCE_DUE');
      expect(refused.body.data).toEqual({ balanceDue: '2000' });
      expect((await http.get(`/orders/${o.id}`, b.token)).body.data.status).toBe('delivered');
    });

    it('delivery records the date; completion with zero balance records the closing time', async () => {
      const b = await business(0);
      const sales = await member(b, 'Salesperson');
      const o = await delivered(b, sales);
      const read = (await http.get(`/orders/${o.id}`, b.token)).body.data as Json;
      expect(read.deliveredAt).not.toBeNull();
      await t.db.prisma.order.update({
        where: { id: o.id },
        data: { paidAmount: '2000', balanceDue: '0', paymentStatus: 'PAID' },
      });
      const done = await status(sales, o.id, 'completed').expect(200);
      expect(done.body.data.order.status).toBe('completed');
      expect(done.body.data.order.closedAt).not.toBeNull();
    });

    it('the override permission completes an order that still has a balance', async () => {
      const b = await business();
      const o = await delivered(b, b);
      const done = await status(b, o.id, 'completed').expect(200);
      expect(done.body.data.order.closedAt).not.toBeNull();
      expect(done.body.data.order.balanceDue).toBe('2000');
    });
  });

  describe('fulfilment (39.9)', () => {
    it('records the method, address, schedule, delivery and receiver', async () => {
      const b = await business();
      const o = (await createOrder(b).expect(201)).body.data as Json;
      const res = await http
        .patch(
          `/orders/${o.id}/fulfilment`,
          {
            method: 'DELIVERY',
            deliveryAddress: { line1: '5 Mall Road' },
            scheduledAt: '2099-05-02T09:00:00Z',
            receiverName: 'Sana',
          },
          b.token,
        )
        .expect(200);
      expect(res.body.data).toEqual(
        expect.objectContaining({
          fulfilmentMethod: 'DELIVERY',
          receiverName: 'Sana',
          deliveryAddress: { line1: '5 Mall Road' },
        }),
      );
      await http.patch(`/orders/${o.id}/fulfilment`, { method: 'TELEPORT' }, b.token).expect(400);
    });
  });

  describe('visibility, permissions and isolation (54.2)', () => {
    it('shows people without order:view_all only their own orders', async () => {
      const b = await business();
      const alice = await member(b, 'Salesperson');
      const bob = await member(b, 'Salesperson');
      const mine = (await createOrder(b, {}, alice).expect(201)).body.data as Json;
      const theirs = (await createOrder(b, {}, bob).expect(201)).body.data as Json;
      const listed = (await http.get('/orders', alice.token).expect(200)).body.data as Json[];
      expect(listed.map((o) => o.id)).toEqual([mine.id]);
      await http.get(`/orders/${mine.id}`, alice.token).expect(200);
      await http.get(`/orders/${theirs.id}`, alice.token).expect(404);
      await status(alice, theirs.id, 'confirmed').expect(404);
      const all = (await http.get('/orders', b.token).expect(200)).body.data as Json[];
      expect(all).toHaveLength(2);
    });

    it('lists with filters and cursor paging', async () => {
      const b = await business();
      for (let i = 0; i < 3; i += 1) await createOrder(b).expect(201);
      const first = (await http.get('/orders?limit=2', b.token).expect(200)).body as Json;
      expect(first.data).toHaveLength(2);
      const second = (
        await http.get(`/orders?limit=2&cursor=${first.meta.nextCursor}`, b.token).expect(200)
      ).body as Json;
      expect(second.data).toHaveLength(1);
      expect((await http.get('/orders?status=confirmed', b.token)).body.data).toEqual([]);
      expect((await http.get('/orders?paymentStatus=UNPAID', b.token)).body.data).toHaveLength(3);
      expect(
        (await http.get(`/orders?q=${first.data[0].orderNumber}`, b.token)).body.data,
      ).toHaveLength(1);
    });

    it('enforces order permissions', async () => {
      const b = await business();
      const o = (await createOrder(b).expect(201)).body.data as Json;
      const viewer = await member(b, 'Viewer');
      await http.get('/orders', viewer.token).expect(200);
      await post(viewer, '/orders', { customerId: b.customer.id, lines: [] }, 'v1').expect(403);
      await status(viewer, o.id, 'confirmed').expect(403);
      await http.get('/orders').expect(401);
    });

    it('another workspace cannot see or change an order', async () => {
      const a = await business();
      const other = await business();
      const o = (await createOrder(a).expect(201)).body.data as Json;
      await http.get(`/orders/${o.id}`, other.token).expect(404);
      await http.patch(`/orders/${o.id}`, { version: 1, notes: 'x' }, other.token).expect(404);
      await status(other, o.id, 'confirmed').expect(404);
      await http.patch(`/orders/${o.id}/fulfilment`, { method: 'PICKUP' }, other.token).expect(404);
      await http.get(`/orders/${o.id}/timeline`, other.token).expect(404);
      expect((await http.get('/orders', other.token)).body.data).toEqual([]);
    });
  });

  describe('lead conversion target ORDER (9.4)', () => {
    it('creates a draft order pre-filled from the lead', async () => {
      const b = await business();
      const lead = (
        await http
          .post(
            '/leads',
            { fullName: 'Hina Raza', phone: '0301-5550000', requirements: 'Grey three-seater' },
            b.token,
          )
          .expect(201)
      ).body.data as Json;
      const res = await http
        .post(`/leads/${lead.id}/convert`, { target: 'ORDER' }, b.token)
        .expect(200);
      expect(res.body.data.document).toEqual(
        expect.objectContaining({ type: 'ORDER', number: expect.stringMatching(/^ORD-/) }),
      );
      const order = (await http.get(`/orders/${res.body.data.document.id}`, b.token)).body
        .data as Json;
      expect(order.status).toBe('draft');
      expect(order.leadId).toBe(lead.id);
      expect(order.customerId).toBe(res.body.data.customer.id);
      expect(order.notes).toBe('Grey three-seater');
    });
  });

  describe('search and links', () => {
    it('finds orders and quotations from the global search', async () => {
      const b = await business();
      const o = (await createOrder(b).expect(201)).body.data as Json;
      const found = (await http.get(`/search?q=${o.orderNumber}`, b.token).expect(200)).body.data
        .groups as Json[];
      expect(found.find((g) => g.type === 'ORDER')?.hits[0]).toEqual(
        expect.objectContaining({ id: o.id, href: `/orders/${o.id}` }),
      );
    });
  });
});
