import request from 'supertest';
import { AIRegistry } from '../../src/modules/ai/ai.registry';
import { FakeAIAdapter } from '../../src/modules/ai/fake-ai.adapter';
import { TenantsService } from '../../src/modules/tenants/tenants.service';
import { DEMO_PRODUCTS } from '../../src/seed/steps/catalog.data';
import { api, createTestApp, type TestApp } from '../helpers/auth-app';
import { EVAL_CONVERSATIONS, type EvalConversation } from './conversations';
import { scoreConversation, summarize, type ScoredField } from './score';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

/**
 * The AI evaluation (Requirement 43.16). In CI a fake adapter replays recorded model answers, so the
 * run checks everything after the model: the grounding rules, the mapping to the catalog and the
 * scoring. With AI_EVAL_LIVE=1 and ANTHROPIC_API_KEY set it asks the real model instead and reports
 * the accuracy it gets; pass the bar with AI_EVAL_THRESHOLD (default 0.85).
 */
const LIVE = process.env['AI_EVAL_LIVE'] === '1' && Boolean(process.env['ANTHROPIC_API_KEY']);
const THRESHOLD = Number(process.env['AI_EVAL_THRESHOLD'] ?? '0.85');

describe(`AI evaluation (${LIVE ? 'live model' : 'recorded answers'})`, () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let token: string;
  let workspaceId: string;
  let connectionId: string;
  let n = 0;
  const fake = new FakeAIAdapter();
  const idOfCode = new Map<string, string>();
  const codeOfId = new Map<string, string>();

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
    const email = 'owner@ai-eval.test';
    await t.app.get(TenantsService).createWorkspace({
      name: 'AI Eval',
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      currency: 'PKR',
      country: 'PK',
    });
    token = (await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200))
      .body.data.accessToken as string;
    workspaceId = (await t.db.prisma.workspace.findFirstOrThrow({ where: { name: 'AI Eval' } })).id;
    const connection = (
      await http
        .post(
          '/integrations',
          { provider: 'WHATSAPP', values: { phoneNumberId: '9990001', accessToken: 'tok' } },
          token,
        )
        .expect(201)
    ).body.data as Json;
    connectionId = connection.id;
    await http
      .patch(
        '/settings',
        { ai: { mode: 'ASSIST', dailyRequestLimit: 10_000, monthlyTokenBudget: 50_000_000 } },
        token,
      )
      .expect(200);
    for (const p of DEMO_PRODUCTS) {
      const row = await t.db.prisma.product.create({
        data: {
          workspaceId,
          code: p.code,
          name: p.name,
          aliases: p.aliases,
          tags: p.tags ?? [],
          basePrice: p.price,
          type: 'NON_STOCKABLE',
          madeToOrder: true,
        },
      });
      idOfCode.set(p.code, row.id);
      codeOfId.set(row.id, p.code);
    }
    if (LIVE) {
      await http
        .post(
          '/integrations',
          { provider: 'ANTHROPIC', values: { apiKey: process.env['ANTHROPIC_API_KEY'] as string } },
          token,
        )
        .expect(201);
      await http.patch('/settings', { ai: { provider: 'ANTHROPIC' } }, token).expect(200);
    } else {
      t.app.get(AIRegistry).useAdapter(fake);
    }
  }, 120_000);
  afterAll(() => t.close());

  /** Puts the conversation in the database as if it had arrived over WhatsApp. */
  async function load(c: EvalConversation) {
    const conversation = await t.db.prisma.conversation.create({
      data: {
        workspaceId,
        connectionId,
        channelType: 'WHATSAPP',
        externalContactId: c.contactPhone,
        contactName: c.contactName,
        contactPhone: c.contactPhone,
      },
    });
    for (const [i, m] of c.messages.entries()) {
      await t.db.prisma.message.create({
        data: {
          workspaceId,
          conversationId: conversation.id,
          externalId: `${c.id}-${i}`,
          direction: m.from === 'CUSTOMER' ? 'INBOUND' : 'OUTBOUND',
          senderType: m.from === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF',
          type: m.image ? 'IMAGE' : 'TEXT',
          body: m.text,
          attachments: m.image
            ? [{ fileId: `file-${c.id}`, name: 'reference.jpg', mime: 'image/jpeg' }]
            : [],
          status: m.from === 'CUSTOMER' ? 'RECEIVED' : 'SENT',
          providerTimestamp: new Date(Date.UTC(2026, 2, 10, 9, i)),
        },
      });
    }
    return conversation.id;
  }

  const extract = (id: string) =>
    request(t.app.getHttpServer())
      .post(`/api/v1/ai/conversations/${id}/extract`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', `10.95.${(++n >> 8) & 255}.${n & 255}`);

  it(`extracts at least ${Math.round(THRESHOLD * 100)}% of the details correctly over ${EVAL_CONVERSATIONS.length} conversations`, async () => {
    const scores = [];
    for (const c of EVAL_CONVERSATIONS) {
      const id = await load(c);
      if (!LIVE) {
        fake.structured({
          fields: c.recorded.fields,
          productMatches: c.recorded.productCodes.map((code) => ({
            productId: idOfCode.get(code) as string,
            confidence: 0.9,
          })),
        });
      }
      const res = (await extract(id).expect(200)).body.data as Json;
      expect(res.status).toBe('OK');
      const fields = (res.suggestion.payload.fields as ScoredField[]).map((f) => ({
        key: f.key,
        value: f.value,
        level: f.level,
      }));
      const products = (
        res.suggestion.payload.productCandidates as Array<{ productId: string }>
      ).map((p) => codeOfId.get(p.productId) as string);
      scores.push(scoreConversation(c, fields, products));
    }
    const report = summarize(scores);
    console.log(
      `AI evaluation (${LIVE ? 'live' : 'recorded'}): ${report.correct}/${report.expected} details correct = ${(report.accuracy * 100).toFixed(1)}% over ${report.conversations} conversations; ${report.wrong} wrong or unasked-for\n` +
        scores
          .filter((s) => s.missed.length || s.wrong.length)
          .map((s) => `  ${s.id}: missed [${s.missed.join(', ')}] wrong [${s.wrong.join(', ')}]`)
          .join('\n'),
    );
    expect(report.accuracy).toBeGreaterThanOrEqual(THRESHOLD);
    if (!LIVE) {
      // the two deliberate mistakes are the only ones, and they are the ones the design expects to see
      const bad = Object.fromEntries(
        scores.filter((s) => s.missed.length || s.wrong.length).map((s) => [s.id, s]),
      );
      expect(Object.keys(bad).sort()).toEqual(['eval-20']);
      expect(bad['eval-20']).toMatchObject({ missed: ['product'], wrong: ['product=CHR-001'] });
    }
  }, 180_000);

  (LIVE ? it.skip : it)(
    'does not trust an invented colour or material: the details nobody mentioned come back LOW',
    async () => {
      const c = EVAL_CONVERSATIONS.find((x) => x.id === 'eval-19') as EvalConversation;
      const id = await load({ ...c, id: 'eval-19b', contactPhone: '923009999999' });
      fake.structured({ fields: c.recorded.fields, productMatches: [] });
      const res = (await extract(id).expect(200)).body.data as Json;
      const byKey = Object.fromEntries(
        (res.suggestion.payload.fields as Json[]).map((f) => [f.key, f]),
      );
      expect(byKey.interest.level).not.toBe('LOW');
      expect(byKey.color).toMatchObject({ level: 'LOW', grounded: false });
      expect(byKey.color.confidence).toBeLessThanOrEqual(0.3);
      expect(byKey.material).toMatchObject({ level: 'LOW', grounded: false });
    },
  );

  it('records every run in the AI log with the prompt version and no conversation text', async () => {
    const logs = await t.db.prisma.aIActionLog.findMany({
      where: { workspaceId, actionType: 'EXTRACT' },
    });
    expect(logs.length).toBeGreaterThanOrEqual(EVAL_CONVERSATIONS.length);
    expect(new Set(logs.map((l) => l.promptVersion))).toEqual(new Set(['extract.v1']));
    expect(logs.every((l) => /^[0-9a-f]{64}$/.test(l.promptHash))).toBe(true);
  });
});
