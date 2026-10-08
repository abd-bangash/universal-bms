import request from 'supertest';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

/** Checkpoint 49: the stock journey from the task list, end to end through the HTTP API. */
describe('Checkpoint — inventory', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
  }, 90_000);
  afterAll(() => t.close());

  const post = (token: string, path: string, body: object = {}, key?: string) => {
    const req = request(t.app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', `10.3.${(++n >> 8) & 255}.${n & 255}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };

  it('opening stock → confirm (available drops, on hand stays) → deliver (on hand drops) → cancel another (available restored); no reason, no adjustment', async () => {
    const email = 'owner@inv-checkpoint.test';
    await t.app.get(TenantsService).createWorkspace({
      name: 'Inventory Checkpoint',
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
          { code: 'SF', name: 'Sofa', basePrice: '1000.00', variants: [{ sku: 'SF-1' }] },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const variantId = product.variants[0].id as string;
    const customer = (
      await http
        .post('/customers', { fullName: 'Checkpoint Stock', phones: ['0300-4440004'] }, token)
        .expect(201)
    ).body.data as Json;
    const reasons = (await http.get('/settings/adjustment-reasons', token)).body.data as Json[];
    const row = async () =>
      ((await http.get('/inventory/stock?q=SF-1', token)).body.data as Json[])[0] as Json;

    // enter opening stock
    await post(
      token,
      '/inventory/opening-stock',
      { lines: [{ variantId, quantity: '10', unitCost: '600' }] },
      'cp-1',
    ).expect(201);
    expect(await row()).toMatchObject({
      onHand: '10',
      reserved: '0',
      available: '10',
      avgCost: '600',
    });

    const order = async (qty: string) =>
      (
        await post(
          token,
          '/orders',
          { customerId: customer.id, lines: [{ variantId, quantity: qty }] },
          `o-${++n}`,
        ).expect(201)
      ).body.data as Json;
    const move = (id: string, status: string, extra: object = {}) =>
      post(token, `/orders/${id}/status`, { status, ...extra });

    // confirm an order: available drops, on hand does not
    const first = await order('3');
    await move(first.id, 'confirmed').expect(200);
    expect(await row()).toMatchObject({ onHand: '10', reserved: '3', available: '7' });

    // deliver it: on hand drops, the reservation is gone
    for (const to of ['in_production', 'ready', 'delivered']) await move(first.id, to).expect(200);
    expect(await row()).toMatchObject({ onHand: '7', reserved: '0', available: '7' });

    // confirm and cancel another: available is restored
    const second = await order('4');
    await move(second.id, 'confirmed').expect(200);
    expect(await row()).toMatchObject({ onHand: '7', reserved: '4', available: '3' });
    await move(second.id, 'cancelled', { reason: 'Customer changed their mind' }).expect(200);
    expect(await row()).toMatchObject({ onHand: '7', reserved: '0', available: '7' });

    // an adjustment without a reason is rejected, and with one is accepted
    await post(
      token,
      '/inventory/movements',
      { variantId, direction: 'OUT', quantity: '1' },
      'cp-adj-1',
    ).expect(400);
    expect((await row()).onHand).toBe('7');
    await post(
      token,
      '/inventory/movements',
      { variantId, direction: 'OUT', quantity: '1', reasonId: reasons[0]!.id },
      'cp-adj-2',
    ).expect(201);
    expect((await row()).onHand).toBe('6');

    // the ledger tells the whole story
    const types = ((await http.get('/inventory/movements', token)).body.data as Json[])
      .map((m) => m.movementType)
      .reverse();
    expect(types).toEqual(['OPENING_STOCK', 'SALE', 'ADJUSTMENT_OUT']);
  });
});
