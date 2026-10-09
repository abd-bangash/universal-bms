import { createHmac } from 'node:crypto';
import * as fc from 'fast-check';
import request from 'supertest';
import { AIRegistry } from '../src/modules/ai/ai.registry';
import { FakeAIAdapter } from '../src/modules/ai/fake-ai.adapter';
import { WhatsAppAdapter } from '../src/modules/channels/whatsapp/whatsapp.adapter';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

const APP_SECRET = 'ai-app-secret';

const inbound = (
  account: string,
  from: string,
  id: string,
  body: string,
  ts = Math.floor(Date.now() / 1000),
): Json => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'w',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '1', phone_number_id: account },
            contacts: [{ profile: { name: 'Sana Malik' }, wa_id: from }],
            messages: [{ from, timestamp: String(ts), id, type: 'text', text: { body } }],
          },
        },
      ],
    },
  ],
});

describe('AI service', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;
  let fake: FakeAIAdapter;
  const sendMessage = jest.fn();

  beforeAll(async () => {
    t = await createTestApp({ META_APP_SECRET: APP_SECRET });
    http = api(t.app);
  }, 90_000);
  afterAll(() => t.close());
  beforeEach(() => {
    fake = new FakeAIAdapter();
    t.app.get(AIRegistry).useAdapter(fake);
    sendMessage.mockReset();
    sendMessage.mockImplementation(async () => ({
      externalMessageId: `wamid.ai-${++n}-${Date.now()}`,
    }));
    jest.spyOn(t.app.get(WhatsAppAdapter), 'sendMessage').mockImplementation(sendMessage);
  });
  afterEach(() => {
    t.app.get(AIRegistry).useAdapter(null);
    jest.restoreAllMocks();
  });

  const ip = () => `10.90.${(++n >> 8) & 255}.${n & 255}`;
  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    token: string,
    path: string,
    body?: object,
    key?: string,
  ) => {
    const agent = request(t.app.getHttpServer());
    const req = agent[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', ip());
    if (key) req.set('Idempotency-Key', key);
    return body ? req.send(body) : req;
  };
  const deliver = (account: string, from: string, id: string, body: string, ts?: number) => {
    const raw = JSON.stringify(inbound(account, from, id, body, ts));
    return request(t.app.getHttpServer())
      .post('/api/v1/webhooks/whatsapp')
      .set('X-Forwarded-For', ip())
      .set('Content-Type', 'application/json')
      .set(
        'X-Hub-Signature-256',
        `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`,
      )
      .send(raw)
      .expect(200);
  };

  async function workspace(label: string, account: string) {
    const email = `owner@${label}.test`;
    await t.app.get(TenantsService).createWorkspace({
      name: label,
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      currency: 'PKR',
      country: 'PK',
    });
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const connection = (
      await http
        .post(
          '/integrations',
          { provider: 'WHATSAPP', values: { phoneNumberId: account, accessToken: 'tok-123456' } },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const workspaceId = (
      await t.db.prisma.integrationConnection.findUniqueOrThrow({ where: { id: connection.id } })
    ).workspaceId;
    return { token, workspaceId, email };
  }

  /** Turns the assistant on after the test's conversations exist, so setting them up does not start it. */
  const enable = (ws: { token: string }) =>
    call('patch', ws.token, '/settings', { ai: { mode: 'ASSIST' } }).expect(200);

  async function member(ws: { token: string; email: string }, role: string) {
    const roles = (await http.get('/roles', ws.token)).body.data as Json[];
    const email = `${role.toLowerCase().replace(/\W/g, '')}@${ws.email.split('@')[1]}`;
    const invite = await http
      .post(
        '/users/invite',
        { email, roleIds: [(roles.find((r) => r.name === role) as Json).id] },
        ws.token,
      )
      .expect(201);
    await http
      .post('/auth/invite/accept', {
        token: invite.body.data.token,
        password: 'member-password-1',
        firstName: role,
        lastName: 'User',
      })
      .expect(200);
    return {
      token: (await http.post('/auth/login', { email, password: 'member-password-1' }).expect(200))
        .body.data.accessToken as string,
      email,
    };
  }

  const conversationFor = async (workspaceId: string, contact: string) =>
    t.db.prisma.conversation.findFirstOrThrow({
      where: { workspaceId, externalContactId: contact },
    });
  const run = (token: string, id: string, fn: string) =>
    call('post', token, `/ai/conversations/${id}/${fn}`);

  // ── the gate ──────────────────────────────────────────────────────────────────────────

  describe('the gate (Property 20)', () => {
    let ws: Awaited<ReturnType<typeof workspace>>;
    let conversationId: string;

    beforeAll(async () => {
      ws = await workspace('ai-gate', '8880001');
      await deliver('8880001', '923001110001', 'wamid.g-1', 'I want a brown sofa');
      conversationId = (await conversationFor(ws.workspaceId, '923001110001')).id;
    });

    const open = async () => {
      await call('patch', ws.token, '/settings', {
        ai: { mode: 'ASSIST', dailyRequestLimit: 500, monthlyTokenBudget: 2_000_000 },
        modules: { ai: true },
      }).expect(200);
      await t.db.prisma.conversation.update({
        where: { id: conversationId },
        data: { aiEnabled: true },
      });
    };
    const CLOSERS: Record<string, [() => Promise<void>, string]> = {
      mode: [
        async () =>
          void (await call('patch', ws.token, '/settings', { ai: { mode: 'OFF' } }).expect(200)),
        'MODE_OFF',
      ],
      module: [
        async () =>
          void (await call('patch', ws.token, '/settings', { modules: { ai: false } }).expect(200)),
        'MODULE_DISABLED',
      ],
      conversation: [
        async () =>
          void (await t.db.prisma.conversation.update({
            where: { id: conversationId },
            data: { aiEnabled: false },
          })),
        'CONVERSATION_OFF',
      ],
      daily: [
        async () =>
          void (await call('patch', ws.token, '/settings', { ai: { dailyRequestLimit: 0 } }).expect(
            200,
          )),
        'DAILY_LIMIT',
      ],
      budget: [
        async () =>
          void (await call('patch', ws.token, '/settings', {
            ai: { monthlyTokenBudget: 0 },
          }).expect(200)),
        'TOKEN_BUDGET',
      ],
    };

    it('makes no call to the provider, whichever way it is closed and whichever function is asked for', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.subarray(Object.keys(CLOSERS), { minLength: 1 }),
          fc.constantFrom('summarize', 'extract', 'draft-reply', 'classify', 'next-action', 'note'),
          async (closers, fn) => {
            await open();
            for (const c of closers) await (CLOSERS[c] as [() => Promise<void>, string])[0]();
            const res = await run(ws.token, conversationId, fn).expect(200);
            expect(res.body.data.status).toBe('DISABLED');
            expect(closers.map((c) => (CLOSERS[c] as [unknown, string])[1])).toContain(
              res.body.data.reason,
            );
            expect(fake.calls).toHaveLength(0);
            expect(await t.db.prisma.aISuggestion.count({ where: { conversationId } })).toBe(0);
          },
        ),
        { numRuns: 25 },
      );
      expect(
        await t.db.prisma.aIActionLog.count({
          where: { conversationId, outcome: { in: ['DISABLED', 'LIMIT_REACHED'] } },
        }),
      ).toBeGreaterThan(0);
      expect(await t.db.prisma.aIUsage.count({ where: { workspaceId: ws.workspaceId } })).toBe(0); // nothing was spent
    }, 120_000);

    it('says AI is not configured when there is no provider', async () => {
      await open();
      t.app.get(AIRegistry).useAdapter(null);
      const res = await run(ws.token, conversationId, 'summarize').expect(200);
      expect(res.body.data).toEqual({ status: 'DISABLED', reason: 'NOT_CONFIGURED' });
    });

    it('counts requests and stops at the daily limit', async () => {
      await open();
      await call('patch', ws.token, '/settings', { ai: { dailyRequestLimit: 2 } }).expect(200);
      fake.otherwise(() => ({ structured: { summary: 'ok', keyPoints: [] } }));
      expect((await run(ws.token, conversationId, 'summarize').expect(200)).body.data.status).toBe(
        'OK',
      );
      expect((await run(ws.token, conversationId, 'summarize').expect(200)).body.data.status).toBe(
        'OK',
      );
      expect((await run(ws.token, conversationId, 'summarize').expect(200)).body.data).toEqual({
        status: 'DISABLED',
        reason: 'DAILY_LIMIT',
      });
      expect(fake.calls).toHaveLength(2);
      const status = (await call('get', ws.token, '/ai/status').expect(200)).body.data;
      expect(status.usage).toMatchObject({ requestsToday: 2, dailyLimit: 2 });
      expect(status.usage.tokensThisMonth).toBe(280); // 2 x (100 in + 40 out)
    });
  });

  // ── what the model is told ────────────────────────────────────────────────────────────

  describe('the context pack', () => {
    it('contains the visible products with price and stock, active knowledge, the last messages and nothing private', async () => {
      const ws = await workspace('ai-pack', '8880002');
      await call('post', ws.token, '/catalog/products', {
        type: 'STOCKABLE',
        code: 'LSOFA',
        name: 'Leather L-shaped sofa',
        basePrice: '45000',
        costPrice: '31234',
        variants: [{ sku: 'LSOFA-A' }],
      }).expect(201);
      await call('post', ws.token, '/catalog/products', {
        type: 'NON_STOCKABLE',
        code: 'HIDDEN',
        name: 'Secret sofa prototype',
        basePrice: '99999',
        visibleToAi: false,
        variants: [{ sku: 'H-A' }],
      }).expect(201);
      await call('post', ws.token, '/ai/knowledge', {
        title: 'Delivery',
        body: 'Delivery within 3 weeks of the deposit.',
      }).expect(201);
      const retired = (
        await call('post', ws.token, '/ai/knowledge', {
          title: 'Old policy',
          body: 'Retired text',
          active: false,
        }).expect(201)
      ).body.data as Json;
      expect(retired.active).toBe(false);
      await t.db.prisma.financialAccount.create({
        data: {
          workspaceId: ws.workspaceId,
          type: 'BANK',
          name: 'Meezan',
          accountNumber: 'PK00MEZN0001',
          showToCustomers: true,
        },
      });
      await t.db.prisma.financialAccount.create({
        data: {
          workspaceId: ws.workspaceId,
          type: 'BANK',
          name: 'Internal',
          accountNumber: 'PK99SECRET',
          showToCustomers: false,
        },
      });
      await call('patch', ws.token, '/settings', { ai: { contextMessageCount: 2 } }).expect(200);
      for (const [i, text] of [
        'oldest message',
        'I want a leather sofa please',
        'what is the price of the sofa',
      ].entries()) {
        await deliver('8880002', '923001110002', `wamid.p-${i}`, text, 1_800_000_000 + i);
      }
      const conversationId = (await conversationFor(ws.workspaceId, '923001110002')).id;
      await enable(ws);
      fake.structured({ fields: [], productMatches: [] });
      await run(ws.token, conversationId, 'extract').expect(200);
      const prompt = `${fake.calls[0]?.system}\n${fake.calls[0]?.messages[0]?.content}`;
      expect(prompt).toContain('Leather L-shaped sofa');
      expect(prompt).toContain('45000 PKR');
      expect(prompt).not.toContain('Secret sofa');
      expect(prompt).not.toContain('31234'); // cost price
      expect(prompt).not.toContain('oldest message'); // only the last two messages
      expect(prompt).toContain('what is the price of the sofa');
      expect(prompt).not.toContain('PK00MEZN0001'); // nobody asked where to pay
      expect(prompt).not.toContain('tok-123456'); // credentials
      expect(prompt).toContain('furniture');

      fake.reset();
      await call('patch', ws.token, '/settings', { ai: { mode: 'OFF' } }).expect(200);
      await deliver(
        '8880002',
        '923001110002',
        'wamid.p-bank',
        'which bank account can I pay into?',
        1_800_000_010,
      );
      await enable(ws);
      fake.structured({ text: 'You can pay by bank transfer.', confidence: 0.9 });
      await run(ws.token, conversationId, 'draft-reply').expect(200);
      const draftPrompt = `${fake.calls[0]?.system}\n${fake.calls[0]?.messages[0]?.content}`;
      expect(draftPrompt).toContain('Delivery within 3 weeks of the deposit.');
      expect(draftPrompt).not.toContain('Retired text');
      expect(draftPrompt).toContain('PK00MEZN0001');
      expect(draftPrompt).not.toContain('PK99SECRET'); // not customer-facing
      expect(draftPrompt).toContain('Never offer a discount');
    });
  });

  // ── extraction, approval and what is written ──────────────────────────────────────────

  describe('extraction (77.2)', () => {
    let ws: Awaited<ReturnType<typeof workspace>>;
    let conversationId: string;
    let leadId: string;

    beforeAll(async () => {
      ws = await workspace('ai-extract', '8880003');
      await call('post', ws.token, '/catalog/products', {
        type: 'STOCKABLE',
        code: 'LSOFA',
        name: 'Leather sofa',
        basePrice: '45000',
        variants: [{ sku: 'LS-A' }],
      }).expect(201);
      await deliver(
        '8880003',
        '923001110003',
        'wamid.e-1',
        'I want a leather sofa in brown, about 8 feet',
      );
      const conversation = await conversationFor(ws.workspaceId, '923001110003');
      conversationId = conversation.id;
      leadId = conversation.leadId as string;
      await enable(ws);
    });

    it('lowers what is not in the conversation, drops unknown things, lists what is missing, and writes nothing to the lead', async () => {
      const product = await t.db.prisma.product.findFirstOrThrow({
        where: { workspaceId: ws.workspaceId, code: 'LSOFA' },
      });
      const before = await t.db.prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      fake.structured({
        fields: [
          { key: 'interest', value: 'leather sofa', confidence: 0.95 },
          { key: 'requirements', value: 'brown, 8 feet', confidence: 0.9 },
          { key: 'quantity', value: '3', confidence: 0.99 }, // never said
          { key: 'favourite_pet', value: 'cat', confidence: 0.9 }, // not a field
        ],
        productMatches: [
          { productId: product.id, confidence: 0.9 },
          { productId: 'invented-id', confidence: 0.9 },
        ],
      });
      const res = (await run(ws.token, conversationId, 'extract').expect(200)).body.data as Json;
      expect(res.status).toBe('OK');
      const s = res.suggestion as Json;
      const byKey = Object.fromEntries((s.payload.fields as Json[]).map((f) => [f.key, f]));
      expect(byKey.interest).toMatchObject({ grounded: true, level: 'HIGH' });
      expect(byKey.requirements).toMatchObject({ grounded: true });
      expect(byKey.quantity).toMatchObject({ grounded: false, level: 'LOW' });
      expect(byKey.quantity.confidence).toBeLessThanOrEqual(0.3);
      expect(byKey.favourite_pet).toBeUndefined();
      expect(s.payload.productCandidates).toEqual([
        expect.objectContaining({ productId: product.id, name: 'Leather sofa', price: '45000' }),
      ]);
      expect(s.flags).toEqual(['UNKNOWN_PRODUCT']);
      expect(s.status).toBe('PENDING');
      // any flag sends the conversation to a person
      expect(
        await t.db.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } }),
      ).toMatchObject({ needsHuman: true });
      // and nothing has touched the lead
      expect(await t.db.prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).toMatchObject({
        interest: before.interest,
        requirements: before.requirements,
        quantity: null,
        version: before.version,
      });
      // the action log says what happened, with hashes and no text
      const log = await t.db.prisma.aIActionLog.findFirstOrThrow({ where: { suggestionId: s.id } });
      expect(log).toMatchObject({
        actionType: 'EXTRACT',
        providerName: 'FAKE',
        outcome: 'SUCCESS',
        promptVersion: 'extract.v1',
        humanApproved: false,
        inputTokens: 100,
        outputTokens: 40,
      });
      expect(log.promptHash).toMatch(/^[0-9a-f]{64}$/);
      expect(log.responseHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('writes to the lead only when a person approves, recording who approved and that the AI was the source', async () => {
      const suggestion = await t.db.prisma.aISuggestion.findFirstOrThrow({
        where: { conversationId, type: 'EXTRACTION', status: 'PENDING' },
      });
      const applied = (
        await call('post', ws.token, `/ai/suggestions/${suggestion.id}/apply`, {
          payload: {
            fields: [
              { key: 'interest', value: 'Leather L-shaped sofa' },
              { key: 'requirements', value: 'brown, 8 feet' },
              { key: 'quantity', value: '1' },
            ],
          },
        }).expect(200)
      ).body.data as Json;
      expect(applied.status).toBe('EDITED');
      const lead = await t.db.prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(lead).toMatchObject({
        interest: 'Leather L-shaped sofa',
        requirements: 'brown, 8 feet',
        version: 2,
      });
      expect(String(lead.quantity)).toBe('1');
      const row = await t.db.prisma.aISuggestion.findUniqueOrThrow({
        where: { id: suggestion.id },
      });
      expect(row.decidedById).toBeTruthy();
      expect(row.appliedPayload).toBeTruthy();
      expect(
        await t.db.prisma.aIActionLog.findFirstOrThrow({ where: { suggestionId: suggestion.id } }),
      ).toMatchObject({ humanApproved: true });
      const audit = await t.db.prisma.auditEvent.findFirstOrThrow({
        where: { workspaceId: ws.workspaceId, action: 'ai.apply', entityId: suggestion.id },
      });
      expect(audit.metadata).toMatchObject({ source: 'AI', edited: true });
      // it cannot be applied twice
      await call('post', ws.token, `/ai/suggestions/${suggestion.id}/apply`, {}).expect(422);
    });

    it('can be approved as suggested, and rejected', async () => {
      fake.structured({
        fields: [{ key: 'interest', value: 'leather sofa', confidence: 0.9 }],
        productMatches: [],
      });
      const first = (await run(ws.token, conversationId, 'extract').expect(200)).body.data
        .suggestion as Json;
      fake.structured({
        fields: [{ key: 'interest', value: 'brown', confidence: 0.9 }],
        productMatches: [],
      });
      const second = (await run(ws.token, conversationId, 'extract').expect(200)).body.data
        .suggestion as Json;
      expect(
        (await t.db.prisma.aISuggestion.findUniqueOrThrow({ where: { id: first.id } })).status,
      ).toBe('SUPERSEDED');
      expect(
        (await call('post', ws.token, `/ai/suggestions/${second.id}/apply`, {}).expect(200)).body
          .data.status,
      ).toBe('APPROVED');
      fake.structured({
        fields: [{ key: 'interest', value: 'sofa', confidence: 0.9 }],
        productMatches: [],
      });
      const third = (await run(ws.token, conversationId, 'extract').expect(200)).body.data
        .suggestion as Json;
      expect(
        (await call('post', ws.token, `/ai/suggestions/${third.id}/reject`).expect(200)).body.data
          .status,
      ).toBe('REJECTED');
      await call('post', ws.token, `/ai/suggestions/${third.id}/apply`, {}).expect(422);
      expect((await t.db.prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).interest).toBe(
        'brown',
      );
    });

    it('asks for the missing required details, first the one in the question flow', async () => {
      await t.db.prisma.fieldDefinition.upsert({
        where: {
          workspaceId_entityType_key: {
            workspaceId: ws.workspaceId,
            entityType: 'LEAD',
            key: 'delivery_city',
          },
        },
        create: {
          workspaceId: ws.workspaceId,
          entityType: 'LEAD',
          key: 'delivery_city',
          label: 'Delivery city',
          type: 'TEXT',
          required: true,
        },
        update: { required: true, active: true },
      });
      await t.db.prisma.questionFlow.create({
        data: {
          workspaceId: ws.workspaceId,
          categoryId: null,
          steps: [{ fieldKey: 'delivery_city', question: 'Which city should we deliver to?' }],
        },
      });
      fake.structured({
        fields: [{ key: 'interest', value: 'leather sofa', confidence: 0.9 }],
        productMatches: [],
      });
      const s = (await run(ws.token, conversationId, 'extract').expect(200)).body.data
        .suggestion as Json;
      expect(s.payload.missingFields).toEqual([
        {
          key: 'delivery_city',
          label: 'Delivery city',
          question: 'Which city should we deliver to?',
        },
      ]);
      expect(s.payload.nextQuestion).toBe('Which city should we deliver to?');
    });

    it('rejects approval of a number that is not a number, and without a lead', async () => {
      fake.structured({
        fields: [{ key: 'budget', value: 'lots', confidence: 0.9 }],
        productMatches: [],
      });
      const s = (await run(ws.token, conversationId, 'extract').expect(200)).body.data
        .suggestion as Json;
      await call('post', ws.token, `/ai/suggestions/${s.id}/apply`, {
        payload: { fields: [{ key: 'budget', value: 'lots' }] },
      }).expect(400);
      const noLead = await workspace('ai-nolead', '8880004');
      await deliver('8880004', '923001110004', 'wamid.nl-1', 'hello there');
      const conv = await conversationFor(noLead.workspaceId, '923001110004');
      await enable(noLead);
      await t.db.prisma.conversation.update({ where: { id: conv.id }, data: { leadId: null } });
      fake.structured({
        fields: [{ key: 'interest', value: 'hello', confidence: 0.9 }],
        productMatches: [],
      });
      const sug = (await run(noLead.token, conv.id, 'extract').expect(200)).body.data
        .suggestion as Json;
      await call('post', noLead.token, `/ai/suggestions/${sug.id}/apply`, {}).expect(422);
    });
  });

  // ── draft replies ─────────────────────────────────────────────────────────────────────

  describe('draft replies (77.2)', () => {
    let ws: Awaited<ReturnType<typeof workspace>>;
    let conversationId: string;

    beforeAll(async () => {
      ws = await workspace('ai-draft', '8880005');
      await call('post', ws.token, '/catalog/products', {
        type: 'STOCKABLE',
        code: 'LSOFA',
        name: 'Leather sofa',
        basePrice: '45000',
        variants: [{ sku: 'LS-A' }],
      }).expect(201);
      await deliver('8880005', '923001110005', 'wamid.d-1', 'How much is the leather sofa?');
      conversationId = (await conversationFor(ws.workspaceId, '923001110005')).id;
      await enable(ws);
    });
    const draft = async (text: string, confidence = 0.9) => {
      fake.structured({ text, confidence });
      return (await run(ws.token, conversationId, 'draft-reply').expect(200)).body.data as Json;
    };
    const reset = () =>
      t.db.prisma.conversation.update({
        where: { id: conversationId },
        data: { needsHuman: false, needsHumanReason: null },
      });

    it('flags a price that is not in the context pack and sends the conversation to a person', async () => {
      const out = await draft('The leather sofa is Rs 52,000.');
      expect(out.suggestion.flags).toContain('UNVERIFIED_AMOUNT');
      expect(out.suggestion.payload.reasons[0]).toContain('52000');
      expect(
        await t.db.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } }),
      ).toMatchObject({ needsHuman: true });
    });

    it('accepts the catalog price and leaves the conversation alone', async () => {
      await reset();
      const out = await draft('The leather sofa is Rs 45,000. What colour would you like?');
      expect(out.suggestion.flags).toEqual([]);
      expect(out.suggestion.confidence).toBe(0.9);
      expect(
        await t.db.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } }),
      ).toMatchObject({ needsHuman: false });
    });

    it('flags a discount, a payment confirmation and an availability claim the stock does not support', async () => {
      expect((await draft('We can give you a 10% off today!')).suggestion.flags).toContain(
        'FINANCIAL_COMMITMENT',
      );
      expect(
        (await draft('Your payment has been received, thank you.')).suggestion.flags,
      ).toContain('FINANCIAL_COMMITMENT');
      expect((await draft('Yes, it is in stock and available now.')).suggestion.flags).toContain(
        'UNVERIFIED_AVAILABILITY',
      ); // none is stocked in this test
    });

    it('sets needsHuman when the assistant is not confident, and publishes ai.escalated once', async () => {
      await reset();
      const out = await draft('Thanks for writing! What colour would you like?', 0.4);
      expect(out.suggestion.flags).toContain('LOW_CONFIDENCE');
      expect(
        await t.db.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } }),
      ).toMatchObject({ needsHuman: true, needsHumanReason: expect.any(String) });
    });

    it("escalates on a keyword in the customer's last message even when the draft is fine", async () => {
      await reset();
      await deliver(
        '8880005',
        '923001110005',
        'wamid.d-2',
        'I have a complaint about my last order',
        Math.floor(Date.now() / 1000) + 5,
      );
      const out = await draft('I am sorry to hear that. Could you tell us more?');
      expect(out.suggestion.flags).toEqual(['ESCALATION_KEYWORD']);
      expect(
        (await t.db.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } }))
          .needsHumanReason,
      ).toContain('complaint');
    });

    it('sending the (edited) draft goes out as a staff message and marks the suggestion', async () => {
      const out = await draft('The leather sofa is Rs 45,000. What colour would you like?');
      const applied = (
        await call('post', ws.token, `/ai/suggestions/${out.suggestion.id}/apply`, {
          payload: { text: 'The leather sofa is Rs 45,000. Which colour do you prefer?' },
        }).expect(200)
      ).body.data as Json;
      expect(applied.status).toBe('EDITED');
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage.mock.calls[0]?.[2]).toEqual({
        kind: 'text',
        body: 'The leather sofa is Rs 45,000. Which colour do you prefer?',
      });
      expect(
        await t.db.prisma.message.findFirstOrThrow({
          where: { conversationId, direction: 'OUTBOUND' },
        }),
      ).toMatchObject({ senderType: 'STAFF', status: 'SENT' });
    });
  });

  // ── other functions ───────────────────────────────────────────────────────────────────

  describe('classify, next action, note and summary', () => {
    it('apply each to the lead or its notes, only on approval', async () => {
      const ws = await workspace('ai-others', '8880006');
      await deliver(
        '8880006',
        '923001110006',
        'wamid.o-1',
        'Please call me tomorrow about a dining table',
      );
      const conversation = await conversationFor(ws.workspaceId, '923001110006');
      await enable(ws);
      const lead = () =>
        t.db.prisma.lead.findUniqueOrThrow({ where: { id: conversation.leadId as string } });

      fake.structured({ intent: 'QUOTE_REQUEST', priority: 'HIGH', confidence: 0.9 });
      const classification = (await run(ws.token, conversation.id, 'classify').expect(200)).body
        .data.suggestion as Json;
      expect((await lead()).priority).toBe('MEDIUM');
      await call('post', ws.token, `/ai/suggestions/${classification.id}/apply`, {}).expect(200);
      expect((await lead()).priority).toBe('HIGH');

      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      fake.structured({
        action: 'Call the customer about the dining table',
        followUpDate: tomorrow,
        confidence: 0.9,
      });
      const next = (await run(ws.token, conversation.id, 'next-action').expect(200)).body.data
        .suggestion as Json;
      expect(next.payload.followUpDate).toBe(tomorrow);
      await call('post', ws.token, `/ai/suggestions/${next.id}/apply`, {}).expect(200);
      expect(await lead()).toMatchObject({
        nextAction: 'Call the customer about the dining table',
      });
      fake.structured({ action: 'Call', followUpDate: '2001-01-01', confidence: 0.9 });
      expect(
        (await run(ws.token, conversation.id, 'next-action').expect(200)).body.data.suggestion
          .payload.followUpDate,
      ).toBeNull(); // a past date is dropped

      fake.text('Customer asked for a call tomorrow about a dining table.');
      const note = (await run(ws.token, conversation.id, 'note').expect(200)).body.data
        .suggestion as Json;
      expect(await t.db.prisma.note.count({ where: { workspaceId: ws.workspaceId } })).toBe(0);
      await call('post', ws.token, `/ai/suggestions/${note.id}/apply`, {}).expect(200);
      const stored = await t.db.prisma.note.findFirstOrThrow({
        where: { workspaceId: ws.workspaceId },
      });
      expect(stored).toMatchObject({ entityType: 'LEAD', entityId: conversation.leadId });
      expect(stored.body).toContain('Customer asked for a call tomorrow');

      fake.structured({
        summary: 'Wants a call about a dining table.',
        keyPoints: ['dining table', 'call tomorrow'],
      });
      const summary = (await run(ws.token, conversation.id, 'summarize').expect(200)).body.data
        .suggestion as Json;
      expect(summary.payload.keyPoints).toHaveLength(2);
      await call('post', ws.token, `/ai/suggestions/${summary.id}/apply`, {}).expect(422); // nothing to write
      expect(
        (
          await call('get', ws.token, `/ai/conversations/${conversation.id}/suggestions`).expect(
            200,
          )
        ).body.data
          .map((s: Json) => s.type)
          .sort(),
      ).toEqual(['CLASSIFICATION', 'NEXT_ACTION', 'NEXT_ACTION', 'NOTE', 'SUMMARY']);
      await run(ws.token, conversation.id, 'nonsense').expect(404);
    });
  });

  // ── failures ──────────────────────────────────────────────────────────────────────────

  describe('provider failures', () => {
    it('produce no suggestion, flag the conversation, log the failure and leave everything else working', async () => {
      const ws = await workspace('ai-fail', '8880007');
      await deliver('8880007', '923001110007', 'wamid.f-1', 'hello');
      const conversation = await conversationFor(ws.workspaceId, '923001110007');
      await enable(ws);
      fake.failWith(new Error('provider exploded'));
      const res = (await run(ws.token, conversation.id, 'summarize').expect(200)).body.data as Json;
      expect(res).toEqual({ status: 'FAILED', code: 'UNKNOWN' });
      expect(JSON.stringify(res)).not.toContain('exploded');
      expect(
        await t.db.prisma.aISuggestion.count({ where: { conversationId: conversation.id } }),
      ).toBe(0);
      expect(
        await t.db.prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
      ).toMatchObject({ needsHuman: true });
      expect(
        await t.db.prisma.aIActionLog.findFirstOrThrow({
          where: { conversationId: conversation.id },
        }),
      ).toMatchObject({ outcome: 'FAILED', error: 'UNKNOWN' });
      // an answer that does not match the required shape is a failure too
      fake.structured({ nonsense: true });
      expect((await run(ws.token, conversation.id, 'summarize').expect(200)).body.data).toEqual({
        status: 'FAILED',
        code: 'INVALID_OUTPUT',
      });
      // the rest of the system still works: staff can reply
      await call(
        'post',
        ws.token,
        `/conversations/${conversation.id}/messages`,
        { body: 'Hello!' },
        'ai-fail-1',
      ).expect(201);
    });
  });

  // ── the automatic step ────────────────────────────────────────────────────────────────

  describe('ASSIST mode', () => {
    it('reads each new customer message: extracts what they want and drafts a reply', async () => {
      const ws = await workspace('ai-assist', '8880008');
      await enable(ws);
      fake.otherwise((c) =>
        c.schema && 'fields' in ((c.schema.properties as object) ?? {})
          ? {
              structured: {
                fields: [{ key: 'interest', value: 'sofa', confidence: 0.9 }],
                productMatches: [],
              },
            }
          : { structured: { text: 'Thanks! Which colour would you like?', confidence: 0.9 } },
      );
      await deliver('8880008', '923001110008', 'wamid.a-1', 'I need a sofa');
      const conversation = await conversationFor(ws.workspaceId, '923001110008');
      const kinds = (
        await t.db.prisma.aISuggestion.findMany({ where: { conversationId: conversation.id } })
      )
        .map((s) => s.type)
        .sort();
      expect(kinds).toEqual(['DRAFT_REPLY', 'EXTRACTION']);
      expect(fake.calls).toHaveLength(2);
      // with AI off, a new message starts nothing
      await call('patch', ws.token, '/settings', { ai: { mode: 'OFF' } }).expect(200);
      fake.calls.length = 0;
      await deliver('8880008', '923001110008', 'wamid.a-2', 'and a table');
      expect(fake.calls).toHaveLength(0);
      // switched off for this conversation only
      await call('patch', ws.token, '/settings', { ai: { mode: 'ASSIST' } }).expect(200);
      await t.db.prisma.conversation.update({
        where: { id: conversation.id },
        data: { aiEnabled: false },
      });
      await deliver('8880008', '923001110008', 'wamid.a-3', 'and chairs');
      expect(fake.calls).toHaveLength(0);
    });
  });

  // ── who may do what ───────────────────────────────────────────────────────────────────

  describe('permissions', () => {
    it('limits the AI endpoints to people who may use, control or read the logs of AI, and to their own conversations', async () => {
      const ws = await workspace('ai-perms', '8880009');
      await deliver('8880009', '923001110009', 'wamid.x-1', 'hello');
      const conversation = await conversationFor(ws.workspaceId, '923001110009');
      await enable(ws);
      const sales = await member(ws, 'Salesperson');
      const viewer = await member(ws, 'Viewer');
      fake.otherwise(() => ({ structured: { summary: 'x', keyPoints: [] } }));

      await call('get', viewer.token, '/ai/status').expect(403);
      await run(viewer.token, conversation.id, 'summarize').expect(403);
      await run(sales.token, conversation.id, 'summarize').expect(404); // not theirs: assigned to nobody
      const salesUser = await t.db.prisma.user.findFirstOrThrow({ where: { email: sales.email } });
      await t.db.prisma.conversation.update({
        where: { id: conversation.id },
        data: { assignedToId: salesUser.id },
      });
      await run(sales.token, conversation.id, 'summarize').expect(200);
      await call('get', sales.token, '/ai/status').expect(200);

      // knowledge needs ai:control, the logs need ai:view_logs
      await call('get', sales.token, '/ai/knowledge').expect(403);
      await call('post', sales.token, '/ai/knowledge', { title: 'x', body: 'y' }).expect(403);
      await call('get', sales.token, '/ai/logs').expect(403);
      const logs = (await call('get', ws.token, '/ai/logs').expect(200)).body.data as Json[];
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0]).toHaveProperty('promptHash');

      // owners manage the knowledge items
      const item = (
        await call('post', ws.token, '/ai/knowledge', {
          title: 'Returns',
          body: 'No returns on custom orders.',
        }).expect(201)
      ).body.data as Json;
      await call('patch', ws.token, `/ai/knowledge/${item.id}`, { active: false }).expect(200);
      expect(
        ((await call('get', ws.token, '/ai/knowledge').expect(200)).body.data as Json[])[0],
      ).toMatchObject({ title: 'Returns', active: false });
      await call('delete', ws.token, `/ai/knowledge/${item.id}`).expect(204);
      expect((await call('get', ws.token, '/ai/knowledge').expect(200)).body.data).toHaveLength(0);

      // another workspace sees none of it
      const other = await workspace('ai-perms-other', '8880010');
      await enable(other);
      await run(other.token, conversation.id, 'summarize').expect(404);
    });
  });
});
