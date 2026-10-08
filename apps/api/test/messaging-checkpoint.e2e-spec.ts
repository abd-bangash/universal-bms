import { createHmac } from 'node:crypto';
import request from 'supertest';
import { WhatsAppAdapter } from '../src/modules/channels/whatsapp/whatsapp.adapter';
import { DocumentRenderer } from '../src/modules/documents/document-renderer';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { renderInNode } from './helpers/render-pdf-node';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

const APP_SECRET = 'checkpoint-app-secret';
const ACCOUNT = '7770001';
const CUSTOMER = '923007771234';

const envelope = (value: Json): Json => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '923001234567', phone_number_id: ACCOUNT },
            ...value,
          },
        },
      ],
    },
  ],
});
const text = (id: string, body: string, ts: number): Json =>
  envelope({
    contacts: [{ profile: { name: 'Checkpoint Buyer' }, wa_id: CUSTOMER }],
    messages: [{ from: CUSTOMER, timestamp: String(ts), id, type: 'text', text: { body } }],
  });
const status = (id: string, s: string, ts: number): Json =>
  envelope({ statuses: [{ id, status: s, timestamp: String(ts), recipient_id: CUSTOMER }] });

/**
 * Checkpoint 75: messaging, against a faked WhatsApp (no Meta test number is available in CI).
 * An enquiry arrives and becomes a lead in a conversation; staff reply from the inbox; delivery
 * reports move the ticks; a repeated webhook changes nothing; a quotation PDF is sent in the chat;
 * the customer accepts and the bank details with the balance go out as a template message.
 */
describe('Checkpoint — messaging', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let token: string;
  let workspaceId: string;
  let n = 0;
  const sent: Array<{ to: string; content: Json }> = [];

  beforeAll(async () => {
    t = await createTestApp({ META_APP_SECRET: APP_SECRET });
    http = api(t.app);
    const renderer = t.app.get(DocumentRenderer);
    jest
      .spyOn(renderer, 'render')
      .mockImplementation((type, snapshot, options) =>
        renderInNode({ ...snapshot, type }, options),
      );
    let i = 0;
    jest
      .spyOn(t.app.get(WhatsAppAdapter), 'sendMessage')
      .mockImplementation(async (_conn, to, content) => {
        sent.push({ to, content: content as unknown as Json });
        return { externalMessageId: `wamid.checkpoint-${++i}` };
      });

    const email = 'owner@msg-checkpoint.test';
    await t.app.get(TenantsService).createWorkspace({
      name: 'Msg Checkpoint',
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      currency: 'PKR',
      country: 'PK',
    });
    token = (await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200))
      .body.data.accessToken as string;
    const connection = (
      await http
        .post(
          '/integrations',
          {
            provider: 'WHATSAPP',
            values: { phoneNumberId: ACCOUNT, accessToken: 'tok-checkpoint' },
          },
          token,
        )
        .expect(201)
    ).body.data as Json;
    workspaceId = (
      await t.db.prisma.integrationConnection.findUniqueOrThrow({ where: { id: connection.id } })
    ).workspaceId;
  }, 90_000);
  afterAll(async () => {
    jest.restoreAllMocks();
    await t.close();
  });

  const deliver = (payload: Json) => {
    const raw = JSON.stringify(payload);
    return request(t.app.getHttpServer())
      .post('/api/v1/webhooks/whatsapp')
      .set('X-Forwarded-For', `10.80.${(++n >> 8) & 255}.${n & 255}`)
      .set('Content-Type', 'application/json')
      .set(
        'X-Hub-Signature-256',
        `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`,
      )
      .send(raw)
      .expect(200);
  };
  const authed = (method: 'get' | 'post' | 'patch', path: string, body?: object, key?: string) => {
    const agent = request(t.app.getHttpServer());
    const req = agent[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', `10.81.${(++n >> 8) & 255}.${n & 255}`);
    if (key) req.set('Idempotency-Key', key);
    return body ? req.send(body) : req;
  };

  it('an enquiry becomes a lead in a conversation; staff reply; delivery reports move the ticks; a repeated webhook changes nothing', async () => {
    const enquiry = text(
      'wamid.cp-in-1',
      'Hello, I would like a custom corner sofa, about 9 ft',
      Math.floor(Date.now() / 1000) - 60,
    );
    await deliver(enquiry);
    await deliver(enquiry); // Meta delivers twice
    expect(await t.db.prisma.lead.count({ where: { workspaceId } })).toBe(1);
    const lead = await t.db.prisma.lead.findFirstOrThrow({ where: { workspaceId } });
    expect(lead).toMatchObject({
      source: 'MESSAGING',
      channel: 'WHATSAPP',
      phoneNormalized: '+923007771234',
    });
    const list = (await authed('get', '/conversations').expect(200)).body.data as Json[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      leadId: lead.id,
      unreadCount: 1,
      lastMessagePreview: 'Hello, I would like a custom corner sofa, about 9 ft',
    });
    expect(await t.db.prisma.message.count({ where: { workspaceId } })).toBe(1);

    const conversationId = list[0]!.id as string;
    const reply = (
      await authed(
        'post',
        `/conversations/${conversationId}/messages`,
        { body: 'Of course! What colour and fabric would you like?' },
        'cp75-1',
      ).expect(201)
    ).body.data as Json[];
    expect(reply[0]).toMatchObject({ status: 'SENT', direction: 'OUTBOUND' });
    expect(sent[0]).toMatchObject({
      to: CUSTOMER,
      content: { kind: 'text', body: 'Of course! What colour and fabric would you like?' },
    });
    const wamid = (await t.db.prisma.message.findUniqueOrThrow({ where: { id: reply[0]!.id } }))
      .externalId as string;

    for (const s of ['delivered', 'read'])
      await deliver(status(wamid, s, Math.floor(Date.now() / 1000)));
    await deliver(status(wamid, 'delivered', Math.floor(Date.now() / 1000))); // late repeat: no step back
    const thread = (await authed('get', `/conversations/${conversationId}/messages`).expect(200))
      .body.data as Json[];
    expect(thread.find((m) => m.id === reply[0]!.id)?.status).toBe('READ');
    expect(
      (await authed('get', `/conversations/${conversationId}`).expect(200)).body.data
        .automationActive,
    ).toBe(false); // a person took over
  });

  it('a quotation PDF is sent in the chat, the customer accepts, and the bank details with the balance go out', async () => {
    const conversation = await t.db.prisma.conversation.findFirstOrThrow({
      where: { workspaceId },
    });
    const lead = await t.db.prisma.lead.findFirstOrThrow({ where: { workspaceId } });
    const quotation = (
      await authed('post', '/quotations', {
        leadId: lead.id,
        lines: [{ kind: 'CUSTOM', name: 'Custom corner sofa', quantity: '1', unitPrice: '120000' }],
      }).expect(201)
    ).body.data as Json;
    await authed('post', `/quotations/${quotation.id}/send`).expect(200);

    sent.length = 0;
    const res = (
      await authed(
        'post',
        `/conversations/${conversation.id}/messages`,
        { body: 'Here is your quotation', attachments: [{ type: 'QUOTATION', id: quotation.id }] },
        'cp75-2',
      ).expect(201)
    ).body.data as Json[];
    expect(res[0]).toMatchObject({ type: 'DOCUMENT', status: 'SENT' });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.content).toMatchObject({
      kind: 'media',
      mediaType: 'document',
      caption: 'Here is your quotation',
    });
    expect(String(sent[0]?.content.filename)).toMatch(/\.pdf$/);
    expect(String(sent[0]?.content.link)).toMatch(/^http/);
    const file = await t.db.prisma.fileAsset.findFirstOrThrow({
      where: { id: res[0]!.attachments[0].fileId },
    });
    expect(file).toMatchObject({ mimeType: 'application/pdf', entityType: 'MESSAGE' });

    // the customer writes back; staff accept the quotation and make the order
    await deliver(
      text('wamid.cp-in-2', 'Looks good, please go ahead', Math.floor(Date.now() / 1000)),
    );
    expect(
      (await authed('get', `/conversations/${conversation.id}`).expect(200)).body.data.unreadCount,
    ).toBe(2); // the enquiry was never opened either
    await authed('post', `/quotations/${quotation.id}/accept`, { via: 'MESSAGE' }).expect(200);
    const converted = (await authed('post', `/quotations/${quotation.id}/convert`).expect(200)).body
      .data as Json;
    const order = converted.order as Json;
    await authed('post', `/orders/${order.id}/status`, { status: 'confirmed' }).expect(200);

    // the new customer is linked to the conversation, and the deposit request goes out as the bank-details template
    const customerId = (await t.db.prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
      .customerId;
    await authed('patch', `/conversations/${conversation.id}`, { customerId }).expect(200);
    await t.db.prisma.financialAccount.create({
      data: {
        workspaceId,
        type: 'BANK',
        name: 'Meezan',
        bankName: 'Meezan Bank',
        accountTitle: 'Acme Furniture',
        accountNumber: 'PK00MEZN0001',
        showToCustomers: true,
      },
    });
    const template = (
      await authed('post', '/templates', {
        name: 'Deposit request',
        kind: 'BANK_DETAILS',
        body: 'Dear {{customer_name}}, order {{order_number}}: please pay the deposit of 60,000 of {{order_total}} to:\n{{bank_details}}',
      }).expect(201)
    ).body.data as Json;
    sent.length = 0;
    const deposit = (
      await authed(
        'post',
        `/conversations/${conversation.id}/messages`,
        { templateId: template.id, orderId: order.id },
        'cp75-3',
      ).expect(201)
    ).body.data as Json[];
    expect(deposit[0].body).toContain('Account number: PK00MEZN0001');
    expect(deposit[0].body).toContain(order.orderNumber);
    expect(deposit[0].body).not.toContain('{{');
    expect(sent[0]?.content).toMatchObject({ kind: 'text' });

    // the deposit arrives and the order moves on
    const cash = ((await authed('get', '/settings/payment-methods')).body.data as Json[]).find(
      (m) => m.name === 'Cash',
    )?.id as string;
    await authed(
      'post',
      '/payments',
      { type: 'DEPOSIT', orderId: order.id, paymentMethodId: cash, amount: '60000' },
      'cp75-4',
    ).expect(201);
    expect((await authed('get', `/orders/${order.id}`)).body.data).toMatchObject({
      status: 'deposit_paid',
      balanceDue: '60000',
    });
  });
});
