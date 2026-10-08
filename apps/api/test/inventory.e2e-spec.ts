import fc from 'fast-check';
import request from 'supertest';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Inventory API (real PostgreSQL)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;
  let keys = 0;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
  }, 90_000);
  afterAll(() => t.close());

  async function business() {
    const email = `owner${++n}@inv.test`;
    const created = await t.app.get(TenantsService).createWorkspace({
      name: `Inv ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
    });
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const roles = (await http.get('/roles', token)).body.data as Json[];
    const product = (
      await http
        .post(
          '/catalog/products',
          {
            code: 'CHAIR',
            name: 'Chair',
            basePrice: '100.00',
            variants: [{ sku: 'CHAIR-A' }, { sku: 'CHAIR-B' }],
          },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const service = (
      await http
        .post(
          '/catalog/products',
          { code: 'DELIV', name: 'Delivery', type: 'SERVICE', basePrice: '50' },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const reasons = (await http.get('/settings/adjustment-reasons', token).expect(200)).body
      .data as Json[];
    const locations = (await http.get('/inventory/locations', token).expect(200)).body
      .data as Json[];
    return {
      ...created,
      token,
      roles,
      a: product.variants[0].id as string,
      b: product.variants[1].id as string,
      productId: product.id as string,
      serviceVariant: service.variants[0].id as string,
      damaged: reasons.find((r) => r.name === 'Damaged')?.id as string,
      location: locations[0].id as string,
    };
  }
  type Biz = Awaited<ReturnType<typeof business>>;

  async function member(b: Biz, roleName: string) {
    const email = `${roleName.toLowerCase().replace(/\W/g, '')}${++n}@inv.test`;
    const role = b.roles.find((r) => r.name === roleName) as Json;
    const invite = await http
      .post('/users/invite', { email, roleIds: [role.id] }, b.token)
      .expect(201);
    await http
      .post('/auth/invite/accept', {
        token: invite.body.data.token,
        password: 'member-password-1',
        firstName: roleName,
        lastName: 'P',
      })
      .expect(200);
    return {
      token: (await http.post('/auth/login', { email, password: 'member-password-1' }).expect(200))
        .body.data.accessToken as string,
    };
  }

  const post = (
    who: { token: string },
    path: string,
    body: object = {},
    key: string | null = `k-${++keys}`,
  ) => {
    const req = request(t.app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${who.token}`)
      .set('X-Forwarded-For', `10.9.${(++n >> 8) & 255}.${n & 255}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const opening = (b: Biz, lines: object[], extra: object = {}) =>
    post(b, '/inventory/opening-stock', { lines, ...extra });
  const adjust = (b: { token: string }, body: object, key?: string) =>
    post(b, '/inventory/movements', body, key);
  const levelOf = async (b: Biz, variantId: string) =>
    await t.db.prisma.stockLevel.findFirst({ where: { workspaceId: b.workspaceId, variantId } });
  const stockRow = async (b: Biz, sku: string, query = '') =>
    (
      (await http.get(`/inventory/stock?q=${sku}${query}`, b.token).expect(200)).body.data as Json[]
    ).find((r) => r.sku === sku);

  describe('opening stock (37.1)', () => {
    it('records opening stock with a unit cost; levels, average cost and value follow', async () => {
      const b = await business();
      const res = await opening(
        b,
        [
          { variantId: b.a, quantity: '10', unitCost: '40' },
          { variantId: b.b, quantity: '4', unitCost: '55.5' },
        ],
        { note: 'Count on 1 March' },
      ).expect(201);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toMatchObject({
        movementType: 'OPENING_STOCK',
        quantityDelta: '10',
        unitCost: '40',
        referenceType: 'OPENING',
        note: 'Count on 1 March',
      });
      expect(await stockRow(b, 'CHAIR-A')).toMatchObject({
        onHand: '10',
        reserved: '0',
        available: '10',
        avgCost: '40',
        stockValue: '400',
      });
      expect(await stockRow(b, 'CHAIR-B')).toMatchObject({ onHand: '4', stockValue: '222' });
    });

    it('is entered once per item and location; later changes are adjustments', async () => {
      const b = await business();
      await opening(b, [{ variantId: b.a, quantity: '10', unitCost: '40' }]).expect(201);
      await opening(b, [{ variantId: b.a, quantity: '5', unitCost: '40' }]).expect(422);
      await opening(b, [
        { variantId: b.b, quantity: '5', unitCost: '1' },
        { variantId: b.b, quantity: '5', unitCost: '1' },
      ]).expect(400);
      expect((await levelOf(b, b.a))?.onHand.toFixed()).toBe('10');
    });

    it('validates quantities, costs, variants and the item type', async () => {
      const b = await business();
      await opening(b, [{ variantId: b.a, quantity: '0', unitCost: '1' }]).expect(400);
      await opening(b, [{ variantId: b.a, quantity: '-3', unitCost: '1' }]).expect(400);
      await opening(b, [{ variantId: b.a, quantity: '3', unitCost: '-1' }]).expect(400);
      await opening(b, [{ variantId: 'nope', quantity: '3', unitCost: '1' }]).expect(400);
      await opening(b, [{ variantId: b.serviceVariant, quantity: '3', unitCost: '1' }]).expect(422); // a service is not stocked
      await opening(b, [], {}).expect(400);
      await opening(b, [{ variantId: b.a, quantity: '3', unitCost: '1' }], {
        locationId: 'nope',
      }).expect(400);
      await post(
        b,
        '/inventory/opening-stock',
        { lines: [{ variantId: b.a, quantity: '3', unitCost: '1' }] },
        null,
      ).expect(400); // Idempotency-Key
    });

    it('converts a quantity in the sale unit to the base unit', async () => {
      const b = await business();
      await t.db.prisma.product.update({
        where: { id: b.productId },
        data: { saleUnitFactor: '12' },
      });
      const res = await opening(b, [
        { variantId: b.a, quantity: '2', unit: 'SALE', unitCost: '10' },
      ]).expect(201);
      expect(res.body.data[0]).toMatchObject({ quantityDelta: '24', unitCost: '0.8333' }); // 10 a dozen is 0.8333 a piece
    });
  });

  describe('adjustments (37.2, 37.5)', () => {
    it('adjusts in and out with a reason and a note', async () => {
      const b = await business();
      await opening(b, [{ variantId: b.a, quantity: '10', unitCost: '40' }]).expect(201);
      const out = await adjust(b, {
        variantId: b.a,
        direction: 'OUT',
        quantity: '3',
        reasonId: b.damaged,
        note: 'Scratched in transit',
      }).expect(201);
      expect(out.body.data).toMatchObject({
        movementType: 'ADJUSTMENT_OUT',
        quantityDelta: '-3',
        reasonId: b.damaged,
        note: 'Scratched in transit',
        referenceType: 'ADJUSTMENT',
      });
      await adjust(b, {
        variantId: b.a,
        direction: 'IN',
        quantity: '2',
        reasonId: b.damaged,
      }).expect(201);
      expect((await levelOf(b, b.a))?.onHand.toFixed()).toBe('9');
    });

    it('an adjustment without a reason, or with an unknown or switched-off one, is rejected', async () => {
      const b = await business();
      await opening(b, [{ variantId: b.a, quantity: '10', unitCost: '40' }]).expect(201);
      await adjust(b, { variantId: b.a, direction: 'OUT', quantity: '1' }).expect(400);
      await adjust(b, { variantId: b.a, direction: 'OUT', quantity: '1', reasonId: 'nope' }).expect(
        400,
      );
      await http
        .patch(`/settings/adjustment-reasons/${b.damaged}`, { active: false }, b.token)
        .expect(200);
      await adjust(b, {
        variantId: b.a,
        direction: 'OUT',
        quantity: '1',
        reasonId: b.damaged,
      }).expect(400);
      expect((await levelOf(b, b.a))?.onHand.toFixed()).toBe('10');
    });

    it('refuses to take more than is available, with 409 and the available quantity (37.5)', async () => {
      const b = await business();
      await opening(b, [{ variantId: b.a, quantity: '5', unitCost: '40' }]).expect(201);
      const res = await adjust(b, {
        variantId: b.a,
        direction: 'OUT',
        quantity: '6',
        reasonId: b.damaged,
      }).expect(409);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
      expect(res.body.data).toMatchObject({ available: '5', requested: '6' });
      expect((await levelOf(b, b.a))?.onHand.toFixed()).toBe('5');
      expect(await t.db.prisma.stockMovement.count({ where: { workspaceId: b.workspaceId } })).toBe(
        1,
      );
    });

    it('allows negative stock when the workspace says so', async () => {
      const b = await business();
      await http
        .patch('/settings', { inventory: { allowNegativeStock: true } }, b.token)
        .expect(200);
      await adjust(b, {
        variantId: b.a,
        direction: 'OUT',
        quantity: '4',
        reasonId: b.damaged,
      }).expect(201);
      expect((await levelOf(b, b.a))?.onHand.toFixed()).toBe('-4');
    });

    it('weights the average cost on every inbound movement with a cost (37.7)', async () => {
      const b = await business();
      await opening(b, [{ variantId: b.a, quantity: '10', unitCost: '40' }]).expect(201);
      await adjust(b, {
        variantId: b.a,
        direction: 'IN',
        quantity: '10',
        reasonId: b.damaged,
        unitCost: '60',
      }).expect(201);
      expect((await levelOf(b, b.a))?.avgCost.toFixed()).toBe('50'); // (10x40 + 10x60) / 20
      await adjust(b, {
        variantId: b.a,
        direction: 'OUT',
        quantity: '5',
        reasonId: b.damaged,
      }).expect(201);
      expect((await levelOf(b, b.a))?.avgCost.toFixed()).toBe('50'); // selling does not change it
      await adjust(b, {
        variantId: b.a,
        direction: 'IN',
        quantity: '5',
        reasonId: b.damaged,
      }).expect(201); // no cost given: unchanged
      expect((await levelOf(b, b.a))?.avgCost.toFixed()).toBe('50');
    });

    it('is idempotent: the same key creates one movement (54.1)', async () => {
      const b = await business();
      await opening(b, [{ variantId: b.a, quantity: '10', unitCost: '40' }]).expect(201);
      const body = { variantId: b.a, direction: 'OUT', quantity: '2', reasonId: b.damaged };
      const results = await Promise.all(
        Array.from({ length: 4 }, () => adjust(b, body, 'same-key')),
      );
      expect(new Set(results.map((r) => r.status))).toEqual(new Set([201]));
      expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
      expect((await levelOf(b, b.a))?.onHand.toFixed()).toBe('8');
    });

    it('announces low stock once, when available falls below the minimum', async () => {
      const b = await business();
      await t.db.prisma.productVariant.update({ where: { id: b.a }, data: { minStockLevel: '5' } });
      await opening(b, [{ variantId: b.a, quantity: '8', unitCost: '40' }]).expect(201);
      const seen: Json[] = [];
      const bus = t.app.get(
        await import('../src/common/events/domain-event-bus').then((m) => m.DomainEventBus),
      );
      const original = bus.publish.bind(bus);
      jest.spyOn(bus, 'publish').mockImplementation(async (name, input) => {
        if (name === 'stock.low') seen.push(input as Json);
        return original(name, input);
      });
      await adjust(b, {
        variantId: b.a,
        direction: 'OUT',
        quantity: '2',
        reasonId: b.damaged,
      }).expect(201); // 6, still fine
      expect(seen).toHaveLength(0);
      await adjust(b, {
        variantId: b.a,
        direction: 'OUT',
        quantity: '2',
        reasonId: b.damaged,
      }).expect(201); // 4: crossed
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ variantId: b.a });
      await adjust(b, {
        variantId: b.a,
        direction: 'OUT',
        quantity: '1',
        reasonId: b.damaged,
      }).expect(201); // already low
      expect(seen).toHaveLength(1);
      jest.restoreAllMocks();
    });
  });

  describe('stock table and movement list (37.10, 37.11, 7.5)', () => {
    it('flags low and overstock and filters by them, location and search', async () => {
      const b = await business();
      await t.db.prisma.productVariant.update({
        where: { id: b.a },
        data: { minStockLevel: '5', maxStockLevel: '20' },
      });
      await t.db.prisma.productVariant.update({
        where: { id: b.b },
        data: { maxStockLevel: '10' },
      });
      await opening(b, [
        { variantId: b.a, quantity: '3', unitCost: '1' },
        { variantId: b.b, quantity: '15', unitCost: '1' },
      ]).expect(201);
      expect(await stockRow(b, 'CHAIR-A')).toMatchObject({ low: true, overstock: false });
      expect(await stockRow(b, 'CHAIR-B')).toMatchObject({ low: false, overstock: true });
      const low = (await http.get('/inventory/stock?low=true', b.token)).body.data as Json[];
      expect(low.map((r) => r.sku)).toEqual(['CHAIR-A']);
      const over = (await http.get('/inventory/stock?over=true', b.token)).body.data as Json[];
      expect(over.map((r) => r.sku)).toEqual(['CHAIR-B']);
      const all = (await http.get('/inventory/stock', b.token)).body.data as Json[];
      expect(all.map((r) => r.sku)).toEqual(['CHAIR-A', 'CHAIR-B']); // the service is not listed
      expect(
        (await http.get(`/inventory/stock?locationId=${b.location}`, b.token)).body.data as Json[],
      ).toHaveLength(2);
      const page = (await http.get('/inventory/stock?limit=1', b.token)).body as Json;
      expect(page.data).toHaveLength(1);
      const next = (
        await http.get(`/inventory/stock?limit=1&cursor=${page.meta.nextCursor}`, b.token)
      ).body as Json;
      expect(next.data.map((r: Json) => r.sku)).toEqual(['CHAIR-B']);
    });

    it('lists movements newest first with every filter', async () => {
      const b = await business();
      await opening(b, [
        { variantId: b.a, quantity: '10', unitCost: '1' },
        { variantId: b.b, quantity: '10', unitCost: '1' },
      ]).expect(201);
      await adjust(b, {
        variantId: b.a,
        direction: 'OUT',
        quantity: '1',
        reasonId: b.damaged,
      }).expect(201);
      const all = (await http.get('/inventory/movements', b.token).expect(200)).body.data as Json[];
      expect(all[0]).toMatchObject({ movementType: 'ADJUSTMENT_OUT', variantId: b.a });
      expect(all).toHaveLength(3);
      expect(
        (await http.get(`/inventory/movements?variantId=${b.b}`, b.token)).body.data as Json[],
      ).toHaveLength(1);
      expect(
        (await http.get('/inventory/movements?type=OPENING_STOCK', b.token)).body.data as Json[],
      ).toHaveLength(2);
      expect(
        (
          await http.get(
            `/inventory/movements?locationId=${b.location}&referenceType=ADJUSTMENT`,
            b.token,
          )
        ).body.data as Json[],
      ).toHaveLength(1);
      expect(
        (await http.get('/inventory/movements?from=2999-01-01', b.token)).body.data as Json[],
      ).toHaveLength(0);
      const page = (await http.get('/inventory/movements?limit=2', b.token)).body as Json;
      expect(page.data).toHaveLength(2);
      expect(
        (await http.get(`/inventory/movements?limit=2&cursor=${page.meta.nextCursor}`, b.token))
          .body.data as Json[],
      ).toHaveLength(1);
    });
  });

  describe('locations and reasons', () => {
    it('adds locations, keeps one default, and will not switch off a location that holds stock', async () => {
      const b = await business();
      const second = (
        await http
          .post('/inventory/locations', { name: 'Warehouse', type: 'WAREHOUSE' }, b.token)
          .expect(201)
      ).body.data as Json;
      await http.post('/inventory/locations', { name: 'Warehouse' }, b.token).expect(400);
      expect(second.isDefault).toBe(false);
      await http
        .patch(`/inventory/locations/${b.location}`, { active: false }, b.token)
        .expect(422); // the default
      await http
        .patch(`/inventory/locations/${second.id}`, { isDefault: true }, b.token)
        .expect(200);
      const list = (await http.get('/inventory/locations', b.token)).body.data as Json[];
      expect(list.filter((l) => l.isDefault).map((l) => l.id)).toEqual([second.id]);
      await opening(b, [{ variantId: b.a, quantity: '5', unitCost: '1' }], {
        locationId: b.location,
      }).expect(201);
      await http
        .patch(`/inventory/locations/${b.location}`, { active: false }, b.token)
        .expect(422); // still holds stock
      await opening(b, [{ variantId: b.b, quantity: '5', unitCost: '1' }]).expect(201); // the new default
      expect(
        (await t.db.prisma.stockMovement.findFirstOrThrow({ where: { variantId: b.b } }))
          .locationId,
      ).toBe(second.id);
    });

    it('adds, renames and switches off reasons', async () => {
      const b = await business();
      const reason = (
        await http.post('/settings/adjustment-reasons', { name: 'Sample' }, b.token).expect(201)
      ).body.data as Json;
      await http.post('/settings/adjustment-reasons', { name: 'sample' }, b.token).expect(400);
      await http
        .patch(`/settings/adjustment-reasons/${reason.id}`, { name: 'Showroom sample' }, b.token)
        .expect(200);
      await http
        .patch(`/settings/adjustment-reasons/${reason.id}`, { active: false }, b.token)
        .expect(200);
      expect(
        ((await http.get('/settings/adjustment-reasons', b.token)).body.data as Json[]).some(
          (r) => r.id === reason.id,
        ),
      ).toBe(false);
    });
  });

  describe('permissions and isolation', () => {
    it('needs inventory:view to read and inventory:adjust to change stock', async () => {
      const b = await business();
      const sales = await member(b, 'Salesperson'); // may view inventory, not adjust it
      const outsider = await member(b, 'Production Staff');
      await http.get('/inventory/stock', sales.token).expect(200);
      await adjust(sales, {
        variantId: b.a,
        direction: 'IN',
        quantity: '1',
        reasonId: b.damaged,
      }).expect(403);
      await opening({ ...b, token: sales.token } as Biz, [
        { variantId: b.a, quantity: '1', unitCost: '1' },
      ]).expect(403);
      await http.get('/inventory/movements', outsider.token).expect(403);
      await post(sales, '/inventory/locations', { name: 'x' }).expect(403);
      await http.get('/inventory/stock').expect(401);
    });

    it('keeps workspaces apart', async () => {
      const a = await business();
      const other = await business();
      await opening(a, [{ variantId: a.a, quantity: '5', unitCost: '1' }]).expect(201);
      expect(
        ((await http.get('/inventory/stock', other.token)).body.data as Json[]).every(
          (r) => r.onHand === '0',
        ),
      ).toBe(true);
      expect(
        (await http.get('/inventory/movements', other.token)).body.data as Json[],
      ).toHaveLength(0);
      await adjust(other, {
        variantId: a.a,
        direction: 'IN',
        quantity: '1',
        reasonId: other.damaged,
      }).expect(400); // not their variant
      await adjust(other, {
        variantId: other.a,
        direction: 'IN',
        quantity: '1',
        reasonId: a.damaged,
      }).expect(400); // not their reason
      await opening(other, [{ variantId: other.a, quantity: '1', unitCost: '1' }], {
        locationId: a.location,
      }).expect(400);
    });
  });

  describe('properties', () => {
    it('Property 5 — the stock level always equals the sum of the ledger (46.1)', async () => {
      const b = await business();
      const op = fc.oneof(
        fc.record({
          kind: fc.constant('in' as const),
          qty: fc.integer({ min: 1, max: 50 }),
          cost: fc.option(fc.integer({ min: 1, max: 500 }), { nil: undefined }),
        }),
        fc.record({ kind: fc.constant('out' as const), qty: fc.integer({ min: 1, max: 60 }) }),
      );
      await fc.assert(
        fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 12 }), async (ops) => {
          for (const o of ops) {
            await adjust(b, {
              variantId: b.a,
              direction: o.kind === 'in' ? 'IN' : 'OUT',
              quantity: String(o.qty),
              reasonId: b.damaged,
              ...(o.kind === 'in' && o.cost ? { unitCost: String(o.cost) } : {}),
            });
            const sum = await t.db.prisma.stockMovement.aggregate({
              where: { workspaceId: b.workspaceId, variantId: b.a },
              _sum: { quantityDelta: true },
            });
            const level = await levelOf(b, b.a);
            expect(Number(level?.onHand ?? 0)).toBe(Number(sum._sum.quantityDelta ?? 0));
            expect(Number(level?.onHand ?? 0)).toBeGreaterThanOrEqual(0); // the default rule: never negative
          }
        }),
        { numRuns: 12 },
      );
    }, 180_000);

    it('Property 4 — the ledger cannot be updated or deleted (46.1)', async () => {
      const b = await business();
      await opening(b, [{ variantId: b.a, quantity: '10', unitCost: '1' }]).expect(201);
      const movements = await t.db.prisma.stockMovement.findMany({
        where: { workspaceId: b.workspaceId },
      });
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...movements),
          fc.integer({ min: -50, max: 50 }),
          async (m, delta) => {
            await expect(
              t.db.prisma.stockMovement.update({
                where: { id: m.id },
                data: { quantityDelta: String(delta || 1) },
              }),
            ).rejects.toThrow();
            await expect(
              t.db.prisma.stockMovement.delete({ where: { id: m.id } }),
            ).rejects.toThrow();
          },
        ),
        { numRuns: 10 },
      );
      expect(await t.db.prisma.stockMovement.count({ where: { workspaceId: b.workspaceId } })).toBe(
        1,
      );
    });

    it('Property 17 — two operations cannot both take the last unit; stock never goes negative under concurrency (46.2)', async () => {
      const b = await business();
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 2, max: 10 }),
          async (stock, takers) => {
            // reset to exactly `stock` units
            const level = await levelOf(b, b.a);
            const current = Number(level?.onHand ?? 0);
            if (current > 0)
              await adjust(b, {
                variantId: b.a,
                direction: 'OUT',
                quantity: String(current),
                reasonId: b.damaged,
              }).expect(201);
            await adjust(b, {
              variantId: b.a,
              direction: 'IN',
              quantity: String(stock),
              reasonId: b.damaged,
            }).expect(201);
            const results = await Promise.all(
              Array.from({ length: takers }, () =>
                adjust(b, { variantId: b.a, direction: 'OUT', quantity: '1', reasonId: b.damaged }),
              ),
            );
            const ok = results.filter((r) => r.status === 201).length;
            const refused = results.filter((r) => r.status === 409).length;
            expect(ok).toBe(Math.min(stock, takers));
            expect(ok + refused).toBe(takers);
            expect(Number((await levelOf(b, b.a))?.onHand)).toBe(stock - ok);
          },
        ),
        { numRuns: 6 },
      );
    }, 180_000);
  });
});
