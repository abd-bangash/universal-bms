import fc from 'fast-check';
import request from 'supertest';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Stock reservations on the order workflow (real PostgreSQL)', () => {
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
    const email = `owner${++n}@resv.test`;
    const created = await t.app.get(TenantsService).createWorkspace({
      name: `Resv ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      country: 'PK',
    });
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    await http.patch('/settings', { sales: { requiredDepositPercent: 0 } }, token).expect(200);
    const product = (
      await http
        .post(
          '/catalog/products',
          {
            code: 'CH',
            name: 'Chair',
            basePrice: '100.00',
            variants: [{ sku: 'CH-A' }, { sku: 'CH-B' }],
          },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const made = (
      await http
        .post(
          '/catalog/products',
          { code: 'MTO', name: 'Made to order', madeToOrder: true, basePrice: '500' },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const customer = (
      await http
        .post('/customers', { fullName: 'Resv Customer', phones: ['0300-1110001'] }, token)
        .expect(201)
    ).body.data as Json;
    const reasons = (await http.get('/settings/adjustment-reasons', token)).body.data as Json[];
    return {
      ...created,
      token,
      a: product.variants[0].id as string,
      b: product.variants[1].id as string,
      madeToOrder: made.variants[0].id as string,
      customer: customer.id as string,
      reason: reasons[0].id as string,
    };
  }
  type Biz = Awaited<ReturnType<typeof business>>;

  const post = (
    b: { token: string },
    path: string,
    body: object = {},
    key: string | null = `k-${++keys}`,
  ) => {
    const req = request(t.app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${b.token}`)
      .set('X-Forwarded-For', `10.7.${(++n >> 8) & 255}.${n & 255}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const stockUp = (b: Biz, variantId: string, quantity: string, cost = '40') =>
    post(b, '/inventory/opening-stock', {
      lines: [{ variantId, quantity, unitCost: cost }],
    }).expect(201);
  const newOrder = async (b: Biz, lines: Array<{ variantId: string; quantity: string }>) =>
    (await post(b, '/orders', { customerId: b.customer, lines }).expect(201)).body.data as Json;
  const move = (b: Biz, orderId: string, status: string, extra: object = {}) =>
    post(b, `/orders/${orderId}/status`, { status, ...extra }, null);
  const level = async (b: Biz, variantId: string) => {
    const l = await t.db.prisma.stockLevel.findFirst({
      where: { workspaceId: b.workspaceId, variantId },
    });
    return { onHand: l?.onHand.toFixed() ?? '0', reserved: l?.reserved.toFixed() ?? '0' };
  };

  it('confirming reserves: available drops, on hand does not (11.6)', async () => {
    const b = await business();
    await stockUp(b, b.a, '10');
    const order = await newOrder(b, [{ variantId: b.a, quantity: '4' }]);
    await move(b, order.id, 'confirmed').expect(200);
    expect(await level(b, b.a)).toEqual({ onHand: '10', reserved: '4' });
    const row = ((await http.get('/inventory/stock?q=CH-A', b.token)).body.data as Json[])[0];
    expect(row).toMatchObject({ onHand: '10', reserved: '4', available: '6' });
    const reservations = await t.db.prisma.stockReservation.findMany({
      where: { orderId: order.id },
    });
    expect(reservations).toEqual([expect.objectContaining({ status: 'ACTIVE', variantId: b.a })]);
    expect(reservations[0]!.quantity.toFixed()).toBe('4');
    const picker = (await http.get('/catalog/variants/lookup?code=CH-A', b.token)).body
      .data as Json;
    expect(picker.availableStock).toBe('6');
  });

  it('insufficient stock on confirmation returns 409 naming the lines, and changes nothing (37.5)', async () => {
    const b = await business();
    await stockUp(b, b.a, '3');
    await stockUp(b, b.b, '10');
    const order = await newOrder(b, [
      { variantId: b.a, quantity: '5' },
      { variantId: b.b, quantity: '2' },
    ]);
    const res = await move(b, order.id, 'confirmed').expect(409);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.data.lines).toEqual([
      expect.objectContaining({ lineNo: 1, variantId: b.a, requested: '5', available: '3' }),
    ]);
    expect((await http.get(`/orders/${order.id}`, b.token)).body.data.status).toBe('draft');
    expect(await level(b, b.a)).toEqual({ onHand: '3', reserved: '0' });
    expect(await level(b, b.b)).toEqual({ onHand: '10', reserved: '0' });
    expect(await t.db.prisma.stockReservation.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('two orders cannot reserve the same stock; the second one fails, the first holds', async () => {
    const b = await business();
    await stockUp(b, b.a, '5');
    const one = await newOrder(b, [{ variantId: b.a, quantity: '4' }]);
    const two = await newOrder(b, [{ variantId: b.a, quantity: '2' }]);
    await move(b, one.id, 'confirmed').expect(200);
    const res = await move(b, two.id, 'confirmed').expect(409);
    expect(res.body.data.lines[0]).toMatchObject({ requested: '2', available: '1' });
    expect(await level(b, b.a)).toEqual({ onHand: '5', reserved: '4' });
  });

  it('cancelling gives the stock back (11.7)', async () => {
    const b = await business();
    await stockUp(b, b.a, '10');
    const order = await newOrder(b, [{ variantId: b.a, quantity: '4' }]);
    await move(b, order.id, 'confirmed').expect(200);
    await move(b, order.id, 'cancelled', { reason: 'Changed mind' }).expect(200);
    expect(await level(b, b.a)).toEqual({ onHand: '10', reserved: '0' });
    expect(
      (await t.db.prisma.stockReservation.findFirstOrThrow({ where: { orderId: order.id } }))
        .status,
    ).toBe('RELEASED');
    // the freed stock can be sold again
    const next = await newOrder(b, [{ variantId: b.a, quantity: '10' }]);
    await move(b, next.id, 'confirmed').expect(200);
  });

  it('delivering sells it: on hand drops, the line keeps the cost at that moment (37.8)', async () => {
    const b = await business();
    await stockUp(b, b.a, '10', '40');
    const order = await newOrder(b, [{ variantId: b.a, quantity: '4' }]);
    for (const to of ['confirmed', 'in_production', 'ready'])
      await move(b, order.id, to).expect(200);
    expect(await level(b, b.a)).toEqual({ onHand: '10', reserved: '4' });
    await move(b, order.id, 'delivered').expect(200);
    expect(await level(b, b.a)).toEqual({ onHand: '6', reserved: '0' });
    const sale = await t.db.prisma.stockMovement.findFirstOrThrow({
      where: { referenceType: 'ORDER', referenceId: order.id },
    });
    expect(sale).toMatchObject({ movementType: 'SALE' });
    expect(sale.quantityDelta.toFixed()).toBe('-4');
    const item = await t.db.prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.costPrice?.toFixed()).toBe('40');
    expect(
      (await t.db.prisma.stockReservation.findFirstOrThrow({ where: { orderId: order.id } }))
        .status,
    ).toBe('FULFILLED');
    // a later purchase at another cost does not rewrite the sold line
    await post(b, '/inventory/movements', {
      variantId: b.a,
      direction: 'IN',
      quantity: '10',
      reasonId: b.reason,
      unitCost: '100',
    }).expect(201);
    expect(
      (
        await t.db.prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })
      ).costPrice?.toFixed(),
    ).toBe('40');
  });

  it('holding an order keeps its reservation; resuming does not reserve twice', async () => {
    const b = await business();
    await stockUp(b, b.a, '10');
    const order = await newOrder(b, [{ variantId: b.a, quantity: '4' }]);
    await move(b, order.id, 'confirmed').expect(200);
    await move(b, order.id, 'on_hold').expect(200);
    expect(await level(b, b.a)).toEqual({ onHand: '10', reserved: '4' });
    await move(b, order.id, 'confirmed').expect(200);
    expect(await level(b, b.a)).toEqual({ onHand: '10', reserved: '4' });
    expect(
      await t.db.prisma.stockReservation.count({ where: { orderId: order.id, status: 'ACTIVE' } }),
    ).toBe(1);
  });

  it('lines that are not stocked (made to order, services) are not reserved', async () => {
    const b = await business();
    const order = await newOrder(b, [{ variantId: b.madeToOrder, quantity: '2' }]);
    await move(b, order.id, 'confirmed').expect(200);
    expect(await t.db.prisma.stockReservation.count({ where: { orderId: order.id } })).toBe(0);
    const picker = (await http.get('/catalog/variants/lookup?code=MTO', b.token)).body.data as Json;
    expect(picker.availableStock).toBeNull();
  });

  it('with negative stock allowed, confirming never fails for lack of stock', async () => {
    const b = await business();
    await http.patch('/settings', { inventory: { allowNegativeStock: true } }, b.token).expect(200);
    const order = await newOrder(b, [{ variantId: b.a, quantity: '3' }]);
    await move(b, order.id, 'confirmed').expect(200);
    expect(await level(b, b.a)).toEqual({ onHand: '0', reserved: '3' });
  });

  it('a delivery that brings stock under the minimum announces low stock once', async () => {
    const b = await business();
    await t.db.prisma.productVariant.update({ where: { id: b.a }, data: { minStockLevel: '5' } });
    await stockUp(b, b.a, '8');
    const bus = t.app.get((await import('../src/common/events/domain-event-bus')).DomainEventBus);
    const seen: Json[] = [];
    const original = bus.publish.bind(bus);
    jest.spyOn(bus, 'publish').mockImplementation(async (name, input) => {
      if (name === 'stock.low') seen.push(input as Json);
      return original(name, input);
    });
    const order = await newOrder(b, [{ variantId: b.a, quantity: '4' }]);
    for (const to of ['confirmed', 'in_production', 'ready'])
      await move(b, order.id, to).expect(200);
    expect(seen).toHaveLength(0);
    await move(b, order.id, 'delivered').expect(200);
    expect(seen).toHaveLength(1);
    jest.restoreAllMocks();
  });

  it('keeps workspaces apart', async () => {
    const a = await business();
    const other = await business();
    await stockUp(a, a.a, '10');
    const order = await newOrder(a, [{ variantId: a.a, quantity: '4' }]);
    await move(a, order.id, 'confirmed').expect(200);
    expect(await level(other, other.a)).toEqual({ onHand: '0', reserved: '0' });
    await move(other, order.id, 'cancelled', { reason: 'x' }).expect(404);
    expect(await level(a, a.a)).toEqual({ onHand: '10', reserved: '4' });
  });

  it('Property 6 — reserved equals the active reservations, available is on hand minus reserved, and nothing is oversold (47.1)', async () => {
    const b = await business();
    await stockUp(b, b.a, '12');
    await stockUp(b, b.b, '12');
    type Step =
      | { kind: 'order'; variant: 0 | 1; qty: number }
      | { kind: 'confirm' | 'cancel' | 'deliver' | 'hold'; pick: number };
    const step: fc.Arbitrary<Step> = fc.oneof(
      {
        weight: 3,
        arbitrary: fc.record({
          kind: fc.constant('order' as const),
          variant: fc.constantFrom(0 as const, 1 as const),
          qty: fc.integer({ min: 1, max: 6 }),
        }),
      },
      {
        weight: 4,
        arbitrary: fc.record({ kind: fc.constant('confirm' as const), pick: fc.nat(30) }),
      },
      {
        weight: 2,
        arbitrary: fc.record({ kind: fc.constant('cancel' as const), pick: fc.nat(30) }),
      },
      {
        weight: 2,
        arbitrary: fc.record({ kind: fc.constant('deliver' as const), pick: fc.nat(30) }),
      },
      { weight: 1, arbitrary: fc.record({ kind: fc.constant('hold' as const), pick: fc.nat(30) }) },
    );
    const orders: Json[] = [];
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 4, maxLength: 14 }), async (steps) => {
        for (const s of steps) {
          if (s.kind === 'order') {
            orders.push(
              await newOrder(b, [
                { variantId: s.variant === 0 ? b.a : b.b, quantity: String(s.qty) },
              ]),
            );
          } else if (orders.length > 0) {
            const o = orders[s.pick % orders.length] as Json;
            const current = (await http.get(`/orders/${o.id}`, b.token)).body.data as Json;
            if (s.kind === 'confirm') await move(b, o.id, 'confirmed');
            if (s.kind === 'hold') await move(b, o.id, 'on_hold');
            if (s.kind === 'cancel') await move(b, o.id, 'cancelled', { reason: 'x' });
            if (s.kind === 'deliver') {
              // walk it forward as far as the workflow allows
              for (const to of ['confirmed', 'ready', 'delivered']) {
                if (current.status === 'delivered' || current.status === 'cancelled') break;
                await move(b, o.id, to);
              }
            }
          }
          for (const v of [b.a, b.b]) {
            const lvl = await t.db.prisma.stockLevel.findFirst({
              where: { workspaceId: b.workspaceId, variantId: v },
            });
            const active = await t.db.prisma.stockReservation.aggregate({
              where: { variantId: v, status: 'ACTIVE' },
              _sum: { quantity: true },
            });
            const ledger = await t.db.prisma.stockMovement.aggregate({
              where: { variantId: v },
              _sum: { quantityDelta: true },
            });
            const onHand = Number(lvl?.onHand ?? 0);
            const reserved = Number(lvl?.reserved ?? 0);
            expect(reserved).toBe(Number(active._sum.quantity ?? 0));
            expect(onHand).toBe(Number(ledger._sum.quantityDelta ?? 0));
            expect(onHand - reserved).toBeGreaterThanOrEqual(0);
          }
        }
      }),
      { numRuns: 8 },
    );
  }, 300_000);
});
