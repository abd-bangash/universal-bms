import { createHmac } from 'node:crypto';
import Decimal from 'decimal.js';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AIRegistry } from '../src/modules/ai/ai.registry';
import { FakeAIAdapter } from '../src/modules/ai/fake-ai.adapter';
import { PasswordService } from '../src/modules/auth/password.service';
import { WhatsAppAdapter } from '../src/modules/channels/whatsapp/whatsapp.adapter';
import { DocumentRenderer } from '../src/modules/documents/document-renderer';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { runDemoSeed } from '../src/seed/demo-seed';
import { DEMO_STEPS } from '../src/seed/steps';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { renderInNode, renderReceiptInNode } from './helpers/render-pdf-node';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

process.env['RATE_LIMIT_PER_USER'] = '100000';

const APP_SECRET = 'e2e-app-secret';
const ACCOUNT = '7790001';
const CUSTOMER = '923007791234';

const inbound = (id: string, body: string, ts: number): Json => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'w',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '1', phone_number_id: ACCOUNT },
            contacts: [{ profile: { name: 'Hira Aslam' }, wa_id: CUSTOMER }],
            messages: [{ from: CUSTOMER, timestamp: String(ts), id, type: 'text', text: { body } }],
          },
        },
      ],
    },
  ],
});

/**
 * Task 84: the four workflows of the source specification, end to end through the HTTP API on the
 * demo dataset, each with the real roles. A runs against the fake WhatsApp and the fake AI provider.
 * Every journey ends by checking that the modules agree: orders, payments, stock, commissions, reports.
 */
describe('End-to-end workflows A–D', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let workspaceId: string;
  let n = 0;
  const tokens: Record<string, string> = {};
  const sent: Json[] = [];
  const fake = new FakeAIAdapter();

  const login = async (email: string) =>
    (await http.post('/auth/login', { email, password: 'demo-password-1' }).expect(200)).body.data
      .accessToken as string;
  const call = (
    method: 'get' | 'post' | 'patch',
    who: string,
    path: string,
    body?: object,
    key?: string,
  ) => {
    const agent = request(t.app.getHttpServer());
    const req = agent[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${tokens[who]}`)
      .set('X-Forwarded-For', `10.70.${(++n >> 8) & 255}.${n & 255}`);
    if (key) req.set('Idempotency-Key', key);
    return body ? req.send(body) : req;
  };
  const post = (who: string, path: string, body: object = {}, key?: string) =>
    call('post', who, path, body, key);
  const get = (who: string, path: string) => call('get', who, path);
  const deliver = (payload: Json) => {
    const raw = JSON.stringify(payload);
    return request(t.app.getHttpServer())
      .post('/api/v1/webhooks/whatsapp')
      .set('X-Forwarded-For', `10.71.${(++n >> 8) & 255}.${n & 255}`)
      .set('Content-Type', 'application/json')
      .set(
        'X-Hub-Signature-256',
        `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`,
      )
      .send(raw)
      .expect(200);
  };
  const cashMethod = async () =>
    ((await get('cashier', '/settings/payment-methods')).body.data as Json[]).find(
      (m) => m.name === 'Cash',
    )?.id as string;
  const advance = async (who: string, orderId: string, steps: string[]) => {
    for (const status of steps)
      await post(who, `/orders/${orderId}/status`, { status }).expect(200);
  };

  beforeAll(async () => {
    t = await createTestApp({ META_APP_SECRET: APP_SECRET });
    http = api(t.app);
    t.app.get(AIRegistry).useAdapter(fake);
    const renderer = t.app.get(DocumentRenderer);
    jest
      .spyOn(renderer, 'render')
      .mockImplementation((type, snapshot, options) =>
        renderInNode({ ...snapshot, type }, options),
      );
    jest
      .spyOn(renderer, 'renderReceipt')
      .mockImplementation((data, options) => renderReceiptInNode(data, options));
    let i = 0;
    jest
      .spyOn(t.app.get(WhatsAppAdapter), 'sendMessage')
      .mockImplementation(async (_c, _to, content) => {
        sent.push(content as unknown as Json);
        return { externalMessageId: `wamid.e2e-${++i}` };
      });
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
    // the demo's own WhatsApp line is disconnected: connect it to the number the fake webhook uses
    await post('owner', '/integrations', {
      provider: 'WHATSAPP',
      values: { phoneNumberId: ACCOUNT, accessToken: 'tok-e2e' },
    }).expect(201);
    await http.patch('/settings', { ai: { mode: 'ASSIST' } }, tokens['owner']).expect(200);
  }, 240_000);
  afterAll(async () => {
    jest.restoreAllMocks();
    await t.close();
  });

  it('Workflow A: a WhatsApp enquiry is read by the AI, answered by staff, quoted, paid in two parts and completed', async () => {
    fake.otherwise((c) =>
      c.schema && 'fields' in ((c.schema['properties'] as object) ?? {})
        ? {
            structured: {
              fields: [
                { key: 'interest', value: 'corner sofa', confidence: 0.95 },
                { key: 'quantity', value: '1', confidence: 0.9 },
              ],
              productMatches: [],
            },
          }
        : { structured: { text: 'Of course! What size do you need?', confidence: 0.9 } },
    );
    const now = Math.floor(Date.now() / 1000);
    await deliver(inbound('wamid.e2e-in-1', 'Hi, I want one corner sofa', now - 60));
    await deliver(inbound('wamid.e2e-in-1', 'Hi, I want one corner sofa', now - 60)); // delivered twice

    const conversation = await t.db.prisma.conversation.findFirstOrThrow({
      where: { workspaceId, externalContactId: CUSTOMER },
    });
    expect(await t.db.prisma.message.count({ where: { conversationId: conversation.id } })).toBe(1);
    const lead = await t.db.prisma.lead.findUniqueOrThrow({
      where: { id: conversation.leadId as string },
    });
    expect(lead).toMatchObject({ source: 'MESSAGING', phoneNormalized: '+923007791234' });
    // someone who can assign conversations was told, once
    expect(
      await t.db.prisma.notification.count({
        where: { workspaceId, type: { contains: 'conversation' } },
      }),
    ).toBeGreaterThan(0);

    // the assistant's reading waits for a person; approving it fills the lead
    const suggestions = (
      await get('owner', `/ai/conversations/${conversation.id}/suggestions`).expect(200)
    ).body.data as Json[];
    const extraction = suggestions.find(
      (s) => s.type === 'EXTRACTION' && s.status === 'PENDING',
    ) as Json;
    expect(extraction).toBeDefined();
    expect(
      (await t.db.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).interest,
    ).toBeNull();
    await post('owner', `/ai/suggestions/${extraction.id}/apply`, {}).expect(200);
    expect((await t.db.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).interest).toBe(
      'corner sofa',
    );

    // the reviewed draft goes out through the fake channel
    const draft = suggestions.find(
      (s) => s.type === 'DRAFT_REPLY' && s.status === 'PENDING',
    ) as Json;
    await post('owner', `/ai/suggestions/${draft.id}/apply`, {}).expect(200);
    expect(sent.at(-1)).toMatchObject({ kind: 'text' });
    const wamid = (
      await t.db.prisma.message.findFirstOrThrow({
        where: { conversationId: conversation.id, direction: 'OUTBOUND' },
      })
    ).externalId as string;
    await deliver({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'w',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '1', phone_number_id: ACCOUNT },
                statuses: [
                  { id: wamid, status: 'read', timestamp: String(now), recipient_id: CUSTOMER },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(
      (await t.db.prisma.message.findFirstOrThrow({ where: { externalId: wamid } })).status,
    ).toBe('READ');

    // the manager hands the lead to the salesperson, who now owns the sale
    const rep = await t.db.prisma.user.findFirstOrThrow({
      where: { email: 'salesperson@demo.test' },
    });
    await post('manager', `/leads/${lead.id}/assign`, { assignedToId: rep.id }).expect(200);

    // quotation sent in the chat as a PDF, accepted, converted
    const quotation = (
      await post('salesperson', '/quotations', {
        leadId: lead.id,
        lines: [{ kind: 'CUSTOM', name: 'Corner sofa', quantity: '1', unitPrice: '100000' }],
      }).expect(201)
    ).body.data as Json;
    await post('salesperson', `/quotations/${quotation.id}/send`).expect(200);
    const doc = (
      await post(
        'salesperson',
        `/conversations/${conversation.id}/messages`,
        { body: 'Your quotation', attachments: [{ type: 'QUOTATION', id: quotation.id }] },
        'e2e-a-1',
      ).expect(201)
    ).body.data as Json[];
    expect(doc[0]).toMatchObject({ type: 'DOCUMENT', status: 'SENT' });
    await post('salesperson', `/quotations/${quotation.id}/accept`, { via: 'MESSAGE' }).expect(200);
    const order = (await post('salesperson', `/quotations/${quotation.id}/convert`).expect(200))
      .body.data.order as Json;
    await post('salesperson', `/orders/${order.id}/status`, { status: 'confirmed' }).expect(200);

    const cash = await cashMethod();
    await post('salesperson', `/orders/${order.id}/status`, { status: 'in_production' }).expect(
      422,
    );
    await post(
      'accounts',
      '/payments',
      { type: 'DEPOSIT', orderId: order.id, paymentMethodId: cash, amount: '50000' },
      'e2e-a-2',
    ).expect(201);
    await advance('manager', order.id, ['in_production', 'ready', 'out_for_delivery', 'delivered']);
    await post(
      'accounts',
      '/payments',
      { type: 'ORDER_PAYMENT', orderId: order.id, paymentMethodId: cash, amount: '50000' },
      'e2e-a-3',
    ).expect(201);
    await post('manager', `/orders/${order.id}/status`, { status: 'completed' }).expect(200);

    expect((await get('manager', `/orders/${order.id}`)).body.data).toMatchObject({
      status: 'completed',
      paymentStatus: 'PAID',
      balanceDue: '0',
    });
    // the modules agree: one commission, every AI action logged with who approved it, payments add up
    expect(await t.db.prisma.commission.count({ where: { orderId: order.id } })).toBe(1);
    const logs = await t.db.prisma.aIActionLog.findMany({
      where: { workspaceId, humanApproved: true },
    });
    expect(logs.length).toBeGreaterThanOrEqual(2);
    const paid = (
      await t.db.prisma.payment.findMany({ where: { orderId: order.id, status: 'CONFIRMED' } })
    ).reduce((a, p) => a.plus(p.amount.toFixed()), new Decimal(0));
    expect(paid.toFixed()).toBe(new Decimal(order.totalAmount).toFixed());
  });

  it('Workflow B: a custom order with a deposit, a wrong balance voided and re-taken,', async () => {
    const customer = (
      await post('salesperson', '/customers', {
        fullName: 'B Buyer',
        phones: ['0300-4440001'],
      }).expect(201)
    ).body.data as Json;
    const order = (
      await post(
        'salesperson',
        '/orders',
        {
          customerId: customer.id,
          lines: [{ kind: 'CUSTOM', name: 'Dining table', quantity: '1', unitPrice: '80000' }],
        },
        'e2e-b-0',
      ).expect(201)
    ).body.data as Json;
    await post('salesperson', `/orders/${order.id}/status`, { status: 'confirmed' }).expect(200);
    const cash = await cashMethod();
    const pay = (type: string, amount: string, key: string) =>
      post(
        'accounts',
        '/payments',
        { type, orderId: order.id, paymentMethodId: cash, amount },
        key,
      );

    await pay('DEPOSIT', '40000', 'e2e-b-1').expect(201);
    // the same request twice is one payment
    await pay('DEPOSIT', '40000', 'e2e-b-1').expect(201);
    expect(
      await t.db.prisma.payment.count({ where: { orderId: order.id, status: 'CONFIRMED' } }),
    ).toBe(1);
    await advance('manager', order.id, ['in_production', 'ready', 'out_for_delivery', 'delivered']);
    const wrong = (await pay('ORDER_PAYMENT', '40000', 'e2e-b-2').expect(201)).body.data as Json;
    await post('accounts', `/payments/${wrong.id}/void`, { reason: 'Wrong amount entered' }).expect(
      200,
    );
    expect((await get('manager', `/orders/${order.id}`)).body.data.balanceDue).toBe('40000');
    await pay('ORDER_PAYMENT', '40000', 'e2e-b-4').expect(201);
    await post('manager', `/orders/${order.id}/status`, { status: 'completed' }).expect(200);
    expect((await get('manager', `/orders/${order.id}`)).body.data).toMatchObject({
      paymentStatus: 'PAID',
      balanceDue: '0',
    });
    // the voided payment stays on record, and the audit trail shows who voided it
    expect(await t.db.prisma.payment.findUniqueOrThrow({ where: { id: wrong.id } })).toMatchObject({
      status: 'VOIDED',
    });
    expect(
      await t.db.prisma.auditEvent.count({ where: { workspaceId, entityId: wrong.id } }),
    ).toBeGreaterThan(0);
  });

  it('Workflow C: counter sales deduct stock, are idempotent, print and reprint, and a sale beyond the stock is refused with nothing changed', async () => {
    const variant = await t.db.prisma.productVariant.findFirstOrThrow({
      where: { workspaceId, product: { type: 'STOCKABLE', madeToOrder: false } },
      orderBy: { sku: 'asc' },
    });
    const level = async () =>
      new Decimal(
        (
          await t.db.prisma.stockLevel.findFirstOrThrow({
            where: { workspaceId, variantId: variant.id },
          })
        ).onHand.toFixed(),
      );
    const cash = await cashMethod();
    const before = await level();
    const body = {
      lines: [{ variantId: variant.id, quantity: '1' }],
      payment: { paymentMethodId: cash },
    };
    const sale = (await post('cashier', '/pos/checkout', body, 'e2e-c-1').expect(201)).body
      .data as Json;
    const again = (await post('cashier', '/pos/checkout', body, 'e2e-c-1').expect(201)).body
      .data as Json;
    expect(again.receipt.id).toBe(sale.receipt.id); // a double tap is one sale
    expect((await level()).toString()).toBe(before.minus(1).toString());
    const movements = await t.db.prisma.stockMovement.count({
      where: { workspaceId, variantId: variant.id, referenceId: sale.order.id },
    });
    expect(movements).toBe(1);

    const res = await request(t.app.getHttpServer())
      .get(`/api/v1/documents/receipts/${sale.receipt.id}/pdf?paper=80mm`)
      .set('Authorization', `Bearer ${tokens['cashier']}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    await post('cashier', `/pos/receipts/${sale.receipt.id}/reprint`).expect(200);
    expect((await get('cashier', `/pos/receipts/${sale.receipt.id}`)).body.data.reprintCount).toBe(
      1,
    );

    const refused = await post(
      'cashier',
      '/pos/checkout',
      { ...body, lines: [{ variantId: variant.id, quantity: '100000' }] },
      'e2e-c-2',
    ).expect(409);
    expect(refused.body.code).toBe('INSUFFICIENT_STOCK');
    expect((await level()).toString()).toBe(before.minus(1).toString());
    expect(await t.db.prisma.commission.count({ where: { orderId: sale.order.id } })).toBe(1);
  });

  it('Workflow D: a quotation keeps its price when the catalogue changes, and the invoice issued from the order cannot be altered', async () => {
    const product = await t.db.prisma.product.findFirstOrThrow({ where: { workspaceId } });
    const lead = (
      await post('salesperson', '/leads', {
        fullName: 'D Buyer',
        phone: '0300-4440002',
        interest: product.name,
        source: 'SOCIAL',
      }).expect(201)
    ).body.data as Json;
    const quotation = (
      await post('salesperson', '/quotations', {
        leadId: lead.id,
        lines: [{ kind: 'CUSTOM', name: 'Custom wardrobe', quantity: '2', unitPrice: '30000' }],
      }).expect(201)
    ).body.data as Json;
    await post('salesperson', `/quotations/${quotation.id}/send`).expect(200);
    await post('salesperson', `/quotations/${quotation.id}/accept`, { via: 'PHONE' }).expect(200);
    const order = (await post('salesperson', `/quotations/${quotation.id}/convert`).expect(200))
      .body.data.order as Json;
    expect(order.totalAmount).toBe(quotation.totalAmount);
    await post('salesperson', `/orders/${order.id}/status`, { status: 'confirmed' }).expect(200);

    const invoice = (await post('manager', `/orders/${order.id}/invoice`).expect(201)).body
      .data as Json;
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d+$/);
    await t.db.prisma.product.update({ where: { id: product.id }, data: { basePrice: '1' } });
    await expect(
      t.db.prisma.invoice.update({ where: { id: invoice.id }, data: { totalAmount: '1' } }),
    ).rejects.toThrow(/immutable/);
    await expect(t.db.prisma.invoice.delete({ where: { id: invoice.id } })).rejects.toThrow(
      /immutable/,
    );
    const row = await t.db.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(row.totalAmount.toFixed()).toBe(new Decimal(order.totalAmount).toFixed());
    expect(
      ((await get('manager', `/orders/${order.id}/invoices`)).body.data as Json[]).map((i) => i.id),
    ).toEqual([invoice.id]);
  });

  it('the reports agree with every record the four journeys created', async () => {
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
  });
});
