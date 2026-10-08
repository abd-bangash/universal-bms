import request from 'supertest';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

/** Checkpoint 44: from a confirmed order to a completed, fully paid one, and who may see the money. */
describe('Checkpoint — payments', () => {
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
      .set('X-Forwarded-For', `10.11.${(++n >> 8) & 255}.${n & 255}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };

  it('deposit → Deposit paid → balance → completed; voiding restores the balance', async () => {
    const email = 'owner@pay-checkpoint.test';
    await t.app.get(TenantsService).createWorkspace({
      name: 'Pay Checkpoint',
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      currency: 'PKR',
      country: 'PK',
    });
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const product = (
      await http
        .post(
          '/catalog/products',
          {
            type: 'NON_STOCKABLE',
            code: 'S',
            name: 'Sofa',
            basePrice: '1000.00',
            variants: [{ sku: 'S-A' }],
          },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const customer = (
      await http
        .post('/customers', { fullName: 'Checkpoint Sana', phones: ['0300-4440003'] }, token)
        .expect(201)
    ).body.data as Json;
    const cash = ((await http.get('/settings/payment-methods', token)).body.data as Json[]).find(
      (m) => m.name === 'Cash',
    )?.id as string;

    const order = (
      await post(
        token,
        '/orders',
        { customerId: customer.id, lines: [{ variantId: product.variants[0].id, quantity: '4' }] },
        'cp-1',
      ).expect(201)
    ).body.data as Json;
    const confirmed = (
      await post(token, `/orders/${order.id}/status`, { status: 'confirmed' }).expect(200)
    ).body.data.order as Json;
    expect(confirmed).toMatchObject({ totalAmount: '4000', depositRequired: '2000' }); // the furniture default is 50%

    // 6. record the deposit: the order moves to Deposit paid by itself
    const deposit = (
      await post(
        token,
        '/payments',
        { type: 'DEPOSIT', orderId: order.id, paymentMethodId: cash, amount: '2000' },
        'cp-2',
      ).expect(201)
    ).body.data as Json;
    let current = (await http.get(`/orders/${order.id}`, token)).body.data as Json;
    expect(current).toMatchObject({
      status: 'deposit_paid',
      paymentStatus: 'DEPOSIT_PAID',
      paidAmount: '2000',
      balanceDue: '2000',
    });

    // production can start now that the deposit is in, and the order runs through to delivery
    for (const to of ['in_production', 'ready', 'out_for_delivery', 'delivered']) {
      await post(token, `/orders/${order.id}/status`, { status: to }).expect(200);
    }
    // it cannot be completed while the balance is open (the owner could override; the rule is tested elsewhere)
    // 10. record the balance: paid in full
    const balance = (
      await post(
        token,
        '/payments',
        { type: 'ORDER_PAYMENT', orderId: order.id, paymentMethodId: cash, amount: '2000' },
        'cp-3',
      ).expect(201)
    ).body.data as Json;
    current = (await http.get(`/orders/${order.id}`, token)).body.data as Json;
    expect(current).toMatchObject({ paymentStatus: 'PAID', balanceDue: '0' });

    // voiding the balance payment restores what is owed
    await post(token, `/payments/${balance.id}/void`, { reason: 'Cheque bounced' }).expect(200);
    current = (await http.get(`/orders/${order.id}`, token)).body.data as Json;
    expect(current).toMatchObject({
      paymentStatus: 'DEPOSIT_PAID',
      balanceDue: '2000',
      paidAmount: '2000',
    });

    // pay again and complete: a receipt exists for each confirmed payment
    await post(
      token,
      '/payments',
      { type: 'ORDER_PAYMENT', orderId: order.id, paymentMethodId: cash, amount: '2000' },
      'cp-4',
    ).expect(201);
    await post(token, `/orders/${order.id}/status`, { status: 'completed' }).expect(200);
    current = (await http.get(`/orders/${order.id}`, token)).body.data as Json;
    expect(current).toMatchObject({ status: 'completed', balanceDue: '0', paymentStatus: 'PAID' });
    expect(current.closedAt).not.toBeNull();
    expect(await t.db.prisma.receipt.count({ where: { orderId: order.id } })).toBe(3);
    expect(deposit.paymentNumber).toMatch(/^PAY-/);

    // the order's timeline tells the story
    const timeline = (await http.get(`/orders/${order.id}/timeline`, token)).body.data as Json[];
    expect(
      timeline
        .filter((e) => e.type === 'PAYMENT')
        .map((e) => e.summary)
        .join('|'),
    ).toMatch(/voided: Cheque bounced/);
  });

  it('a user without financial permissions sees no payment or expense data', async () => {
    const email = 'owner@pay-checkpoint2.test';
    await t.app.get(TenantsService).createWorkspace({
      name: 'Pay Checkpoint 2',
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
    });
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const roles = (await http.get('/roles', token)).body.data as Json[];
    const invite = await http
      .post(
        '/users/invite',
        {
          email: 'prod@pay-checkpoint2.test',
          roleIds: [(roles.find((r) => r.name === 'Production Staff') as Json).id],
        },
        token,
      )
      .expect(201);
    await http
      .post('/auth/invite/accept', {
        token: invite.body.data.token,
        password: 'member-password-1',
        firstName: 'P',
        lastName: 'P',
      })
      .expect(200);
    const staff = (
      await http
        .post('/auth/login', { email: 'prod@pay-checkpoint2.test', password: 'member-password-1' })
        .expect(200)
    ).body.data.accessToken as string;
    for (const path of [
      '/payments',
      '/payments/receivables-summary',
      '/expenses',
      '/settings/payment-methods',
      '/settings/financial-accounts',
      '/settings/expense-categories',
    ]) {
      await http.get(path, staff).expect(403);
    }
    await post(
      staff,
      '/payments',
      { type: 'ADVANCE', customerId: 'x', paymentMethodId: 'x', amount: '1' },
      'k',
    ).expect(403);
    await post(staff, '/expenses', {}).expect(403);
  });
});
