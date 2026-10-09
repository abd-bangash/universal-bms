import { createHmac } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { AIRegistry } from '../src/modules/ai/ai.registry';
import { FakeAIAdapter } from '../src/modules/ai/fake-ai.adapter';
import { WhatsAppAdapter } from '../src/modules/channels/whatsapp/whatsapp.adapter';
import { DocumentRenderer } from '../src/modules/documents/document-renderer';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { DEMO_PRODUCTS } from '../src/seed/steps/catalog.data';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { renderInNode } from './helpers/render-pdf-node';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

const APP_SECRET = 'ai-checkpoint-secret';
const ACCOUNT = '7780001';
const CUSTOMER = '923007781234';

const envelope = (value: Json): Json => ({
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
            contacts: [{ profile: { name: 'Sana Malik' }, wa_id: CUSTOMER }],
            ...value,
          },
        },
      ],
    },
  ],
});
const text = (id: string, body: string, ts: number) =>
  envelope({
    messages: [{ from: CUSTOMER, timestamp: String(ts), id, type: 'text', text: { body } }],
  });
const picture = (id: string, caption: string, ts: number) =>
  envelope({
    messages: [
      {
        from: CUSTOMER,
        timestamp: String(ts),
        id,
        type: 'image',
        image: { id: `media-${id}`, mime_type: 'image/png', caption },
      },
    ],
  });

/**
 * Checkpoint 80: the AI assistant on the example from the source specification. Against a fake
 * WhatsApp and a fake AI provider that answers as a careful model would.
 */
describe('Checkpoint — AI', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let token: string;
  let workspaceId: string;
  let conversationId: string;
  let n = 0;
  const fake = new FakeAIAdapter();
  const sent: Json[] = [];
  const idOfCode = new Map<string, string>();

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
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#632' } })
      .png()
      .toBuffer();
    jest
      .spyOn(t.app.get(WhatsAppAdapter), 'downloadMedia')
      .mockResolvedValue({ body: png, mime: 'image/png' });
    jest
      .spyOn(t.app.get(WhatsAppAdapter), 'sendMessage')
      .mockImplementation(async (_c, _to, content) => {
        sent.push(content as unknown as Json);
        return { externalMessageId: `wamid.ai-cp-${sent.length}` };
      });

    const email = 'owner@ai-checkpoint.test';
    await t.app.get(TenantsService).createWorkspace({
      name: 'AI Checkpoint',
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      currency: 'PKR',
      country: 'PK',
    });
    token = (await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200))
      .body.data.accessToken as string;
    workspaceId = (
      await t.db.prisma.workspace.findFirstOrThrow({ where: { name: 'AI Checkpoint' } })
    ).id;
    await http
      .post(
        '/integrations',
        { provider: 'WHATSAPP', values: { phoneNumberId: ACCOUNT, accessToken: 'tok' } },
        token,
      )
      .expect(201);
    for (const p of DEMO_PRODUCTS) {
      const row = await t.db.prisma.product.create({
        data: {
          workspaceId,
          code: p.code,
          name: p.name,
          aliases: p.aliases,
          basePrice: p.price,
          type: 'NON_STOCKABLE',
          madeToOrder: true,
        },
      });
      idOfCode.set(p.code, row.id);
    }
    await http.patch('/settings', { ai: { mode: 'ASSIST' } }, token).expect(200);
  }, 120_000);
  afterAll(async () => {
    jest.restoreAllMocks();
    await t.close();
  });

  const call = (method: 'get' | 'post' | 'patch', path: string, body?: object, key?: string) => {
    const agent = request(t.app.getHttpServer());
    const req = agent[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', `10.99.${(++n >> 8) & 255}.${n & 255}`);
    if (key) req.set('Idempotency-Key', key);
    return body ? req.send(body) : req;
  };
  const deliver = (payload: Json) => {
    const raw = JSON.stringify(payload);
    return request(t.app.getHttpServer())
      .post('/api/v1/webhooks/whatsapp')
      .set('X-Forwarded-For', `10.98.${(++n >> 8) & 255}.${n & 255}`)
      .set('Content-Type', 'application/json')
      .set(
        'X-Hub-Signature-256',
        `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`,
      )
      .send(raw)
      .expect(200);
  };

  it('reads "one L-shaped sofa, about 8 feet, brown leather, same design as this picture" into product, quantity, length, material, colour and the reference picture, and lists what is missing', async () => {
    // the model answers as a careful one would; the second message supplies the picture
    fake.otherwise((c) =>
      c.schema && 'fields' in ((c.schema['properties'] as object) ?? {})
        ? {
            structured: {
              fields: [
                { key: 'interest', value: 'L-shaped sofa', confidence: 0.95 },
                { key: 'quantity', value: '1', confidence: 0.9 },
                { key: 'length', value: '8 feet', confidence: 0.85 },
                { key: 'material', value: 'leather', confidence: 0.95 },
                { key: 'color', value: 'brown', confidence: 0.95 },
                { key: 'design', value: 'same design as this picture', confidence: 0.8 },
                { key: 'reference_image', value: 'image attached', confidence: 0.9 },
              ],
              productMatches: [{ productId: idOfCode.get('SOF-001') as string, confidence: 0.85 }],
            },
          }
        : {
            structured: {
              text: 'Lovely choice! Could you tell us the width and height?',
              confidence: 0.9,
            },
          },
    );
    const now = Math.floor(Date.now() / 1000);
    await deliver(
      text('wamid.cp-1', 'Hi, I want one L-shaped sofa, about 8 feet, in brown leather', now - 60),
    );
    await deliver(picture('wamid.cp-2', 'same design as this picture', now - 30));

    const conversation = await t.db.prisma.conversation.findFirstOrThrow({
      where: { workspaceId, externalContactId: CUSTOMER },
    });
    conversationId = conversation.id;
    const lead = await t.db.prisma.lead.findUniqueOrThrow({
      where: { id: conversation.leadId as string },
    });

    const suggestions = (
      await call('get', `/ai/conversations/${conversationId}/suggestions`).expect(200)
    ).body.data as Json[];
    const extraction = suggestions.find(
      (s) => s.type === 'EXTRACTION' && s.status === 'PENDING',
    ) as Json;
    expect(suggestions.filter((s) => s.type === 'EXTRACTION')).toHaveLength(1); // the first reading was replaced when the picture arrived
    const fields = Object.fromEntries((extraction.payload.fields as Json[]).map((f) => [f.key, f]));
    expect(fields.interest).toMatchObject({
      value: 'L-shaped sofa',
      level: 'HIGH',
      grounded: true,
    });
    expect(fields.quantity).toMatchObject({ value: '1', grounded: true }); // "one" in the chat
    expect(fields.length).toMatchObject({ value: '8 feet', grounded: true });
    expect(fields.material).toMatchObject({ value: 'leather', grounded: true });
    expect(fields.color).toMatchObject({ value: 'brown', grounded: true });
    expect(fields.reference_image).toMatchObject({ value: 'image attached', grounded: true });
    expect(fields.design).toMatchObject({ grounded: true });
    expect(extraction.payload.productCandidates).toEqual([
      expect.objectContaining({
        productId: idOfCode.get('SOF-001'),
        name: 'Milano Corner Sofa',
        price: '145000',
      }),
    ]);
    // a custom size needs all its measurements: only the length was given
    expect(extraction.payload.missingFields).toEqual([
      { key: 'width', label: 'Width', question: 'What is the width?' },
      { key: 'height', label: 'Height', question: 'What is the height?' },
    ]);
    expect(extraction.payload.nextQuestion).toBe('What is the width?');
    expect(extraction.flags).toEqual([]);

    // a reply was drafted for staff to review, and nothing has touched the lead
    expect(suggestions.some((s) => s.type === 'DRAFT_REPLY' && s.status === 'PENDING')).toBe(true);
    expect(lead).toMatchObject({ interest: null, quantity: null, productId: null, version: 1 });
    expect(lead.customFields).toEqual({});
    expect(sent).toHaveLength(0);
  });

  it('approving it fills the lead', async () => {
    const extraction = await t.db.prisma.aISuggestion.findFirstOrThrow({
      where: { conversationId, type: 'EXTRACTION', status: 'PENDING' },
    });
    const applied = (await call('post', `/ai/suggestions/${extraction.id}/apply`, {}).expect(200))
      .body.data as Json;
    expect(applied.status).toBe('APPROVED');
    const lead = await t.db.prisma.lead.findFirstOrThrow({
      where: { workspaceId, phoneNormalized: '+923007781234' },
    });
    expect(lead).toMatchObject({
      interest: 'L-shaped sofa',
      productId: idOfCode.get('SOF-001'),
      version: 2,
    });
    expect(String(lead.quantity)).toBe('1');
    const custom = lead.customFields as Json;
    expect(custom).toMatchObject({
      length: { value: '8', unit: 'ft' },
      size_type: 'custom', // a measurement settles the size
      material: 'leather',
      color: 'brown',
      design: 'same design as this picture',
    });
    // the reference picture is the file the customer sent
    const image = await t.db.prisma.fileAsset.findFirstOrThrow({
      where: { workspaceId, mimeType: 'image/png', entityType: 'MESSAGE' },
    });
    expect(custom.reference_image).toBe(image.id);
    expect(
      await t.db.prisma.aIActionLog.findFirstOrThrow({ where: { suggestionId: extraction.id } }),
    ).toMatchObject({ humanApproved: true });
    expect(
      (
        await t.db.prisma.auditEvent.findFirstOrThrow({
          where: { workspaceId, action: 'ai.apply', entityId: extraction.id },
        })
      ).metadata,
    ).toMatchObject({ source: 'AI' });
  });

  it('the staff send the reviewed draft, and the sale carries on to a deposit (Workflow A)', async () => {
    const draft = await t.db.prisma.aISuggestion.findFirstOrThrow({
      where: { conversationId, type: 'DRAFT_REPLY', status: 'PENDING' },
    });
    await call('post', `/ai/suggestions/${draft.id}/apply`, {
      payload: { text: 'Lovely choice! What width and height do you need?' },
    }).expect(200);
    expect(sent).toEqual([
      { kind: 'text', body: 'Lovely choice! What width and height do you need?' },
    ]);
    expect(
      await t.db.prisma.message.findFirstOrThrow({
        where: { conversationId, direction: 'OUTBOUND' },
      }),
    ).toMatchObject({ senderType: 'STAFF' });

    const lead = await t.db.prisma.lead.findFirstOrThrow({
      where: { workspaceId, phoneNormalized: '+923007781234' },
    });
    const quotation = (
      await call('post', '/quotations', {
        leadId: lead.id,
        lines: [
          {
            kind: 'CUSTOM',
            name: 'Custom L-shaped leather sofa, 8 ft, brown',
            quantity: '1',
            unitPrice: '150000',
          },
        ],
      }).expect(201)
    ).body.data as Json;
    await call('post', `/quotations/${quotation.id}/send`).expect(200);
    await call('post', `/quotations/${quotation.id}/accept`, { via: 'MESSAGE' }).expect(200);
    const order = (
      (await call('post', `/quotations/${quotation.id}/convert`).expect(200)).body.data as Json
    ).order as Json;
    await call('post', `/orders/${order.id}/status`, { status: 'confirmed' }).expect(200);
    const cash = ((await call('get', '/settings/payment-methods')).body.data as Json[]).find(
      (m) => m.name === 'Cash',
    )?.id as string;
    await call(
      'post',
      '/payments',
      { type: 'DEPOSIT', orderId: order.id, paymentMethodId: cash, amount: '75000' },
      'ai-cp-1',
    ).expect(201);
    expect((await call('get', `/orders/${order.id}`)).body.data).toMatchObject({
      status: 'deposit_paid',
      balanceDue: '75000',
    });
  });

  it('turning AI off stops every call to the provider', async () => {
    const before = fake.calls.length;
    await call('patch', '/ai/settings', { mode: 'OFF' }).expect(200);
    // a new customer message starts nothing
    await deliver(
      text('wamid.cp-3', 'Also I need a matching coffee table', Math.floor(Date.now() / 1000)),
    );
    expect(fake.calls).toHaveLength(before);
    // asking on purpose gets a clear answer and no call
    for (const fn of ['summarize', 'extract', 'draft-reply', 'classify', 'next-action', 'note']) {
      const res = (await call('post', `/ai/conversations/${conversationId}/${fn}`).expect(200)).body
        .data as Json;
      expect(res).toEqual({ status: 'DISABLED', reason: 'MODE_OFF' });
    }
    expect(fake.calls).toHaveLength(before);
    // back on, but off for this conversation only
    await call('patch', '/ai/settings', { mode: 'ASSIST' }).expect(200);
    await call('patch', `/conversations/${conversationId}`, { aiEnabled: false }).expect(200);
    await deliver(
      text('wamid.cp-4', 'What colours does it come in?', Math.floor(Date.now() / 1000) + 1),
    );
    expect(
      (await call('post', `/ai/conversations/${conversationId}/summarize`).expect(200)).body.data,
    ).toEqual({ status: 'DISABLED', reason: 'CONVERSATION_OFF' });
    expect(fake.calls).toHaveLength(before);
    // the status the screens read says why
    expect((await call('get', '/ai/status').expect(200)).body.data).toMatchObject({
      mode: 'ASSIST',
      moduleEnabled: true,
    });
  });
});
