import { createHmac } from 'node:crypto';
import * as fc from 'fast-check';
import request from 'supertest';
import { WhatsAppAdapter } from '../src/modules/channels/whatsapp/whatsapp.adapter';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

/**
 * Property 13 — input safety (Requirement 20.2, design decision D10). Whatever characters a person
 * types into a text field, the request is accepted when it meets the field's length and type rules,
 * what is stored is what was typed, and no other row changes. Quote marks, comment markers and SQL
 * keywords are not rejected (they are part of real names and notes: "O'Brien"); they are simply data.
 */
const NASTY = [
  "'",
  '"',
  '\\',
  '%',
  '_',
  '--',
  '/*',
  '*/',
  ';',
  '`',
  '$1',
  '${7*7}',
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  "' OR 1=1 --",
  "'; DROP TABLE customers; --",
  '") OR ("a"="a',
  "x'); DELETE FROM leads WHERE ('1'='1",
  'UNION SELECT password FROM users',
  "O'Brien",
  'Zoë Ñandú',
  'محمد علی',
  '😀 emoji',
  'null',
  'undefined',
  'NaN',
  '[]',
  '{}',
  '%00',
  '\\n',
  '../../etc/passwd',
  'ß',
];
const text = (max: number) =>
  fc
    .oneof(
      fc.constantFrom(...NASTY),
      fc.string({ minLength: 1, maxLength: max }),
      fc.array(fc.constantFrom(...NASTY), { minLength: 1, maxLength: 5 }).map((a) => a.join(' ')),
    )
    .map((s) => s.trim().slice(0, max).trim())
    .filter((s) => s.length > 0);
/** Message templates give meaning to {{ }}, so templates are tried without it. */
const noBraces = (max: number) => text(max).filter((s) => !s.includes('{'));

/** Rows that must never change because of someone typing text into an unrelated field. */
const WATCHED = [
  'user',
  'workspace',
  'role',
  'userWorkspace',
  'financialAccount',
  'paymentMethod',
  'payment',
  'order',
  'product',
  'customer',
  'lead',
  'supplier',
  'quotation',
  'expense',
  'category',
  'task',
  'note',
  'messageTemplate',
  'knowledgeItem',
  'message',
  'conversation',
  'integrationConnection',
] as const;
type Watched = (typeof WATCHED)[number];

// this test sends far more than a person's 300 requests a minute on purpose (the limit itself is tested in security-review)
process.env['RATE_LIMIT_PER_USER'] = '1000000';

describe('Property 13 — input safety', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let token: string;
  let workspaceId: string;
  let n = 0;
  let seq = 0;
  const APP_SECRET = 'safety-secret';

  beforeAll(async () => {
    t = await createTestApp({ META_APP_SECRET: APP_SECRET });
    http = api(t.app);
    const email = 'owner@safety.test';
    await t.app.get(TenantsService).createWorkspace({
      name: 'Safety',
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      currency: 'PKR',
      country: 'PK',
    });
    token = (await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200))
      .body.data.accessToken as string;
    workspaceId = (await t.db.prisma.workspace.findFirstOrThrow({ where: { name: 'Safety' } })).id;
    await http
      .post(
        '/integrations',
        { provider: 'WHATSAPP', values: { phoneNumberId: '4440001', accessToken: 'tok' } },
        token,
      )
      .expect(201);
    jest
      .spyOn(t.app.get(WhatsAppAdapter), 'sendMessage')
      .mockImplementation(async () => ({ externalMessageId: `wamid.safe-${++seq}` }));
  }, 90_000);
  afterAll(() => t.close());

  const call = (method: 'get' | 'post' | 'patch', path: string, body?: object, key?: string) => {
    const agent = request(t.app.getHttpServer());
    const req = agent[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', `10.66.${(++n >> 8) & 255}.${n & 255}`);
    if (key) req.set('Idempotency-Key', key);
    return body ? req.send(body) : req;
  };

  async function snapshot(): Promise<Record<Watched, number>> {
    const prisma = t.db.prisma as unknown as Record<
      string,
      { count(a?: unknown): Promise<number> }
    >;
    const out = {} as Record<Watched, number>;
    for (const model of WATCHED) out[model] = await prisma[model]!.count();
    return out;
  }
  const delta = (before: Record<Watched, number>, after: Record<Watched, number>) =>
    Object.fromEntries(WATCHED.map((m) => [m, after[m] - before[m]]).filter(([, d]) => d !== 0));

  /** Submits, then checks: accepted, stored as typed, and nothing else changed. */
  async function safe(
    label: string,
    submit: () => Promise<request.Response>,
    expectRows: Partial<Record<Watched, number>>,
    stored: (res: request.Response) => Promise<unknown[]>,
    typed: unknown[],
  ) {
    const before = await snapshot();
    const res = await submit();
    if (res.status !== 201 && res.status !== 200)
      throw new Error(
        `${label}: rejected with ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`,
      );
    expect(await stored(res)).toEqual(typed);
    expect(delta(before, await snapshot())).toEqual(expectRows);
  }

  const phone = () => `+9230${String(1_000_000 + ++seq).slice(-7)}`;
  const code = () => `P${++seq}`;
  const RUNS = 12;

  it('customers: name and notes', async () => {
    await fc.assert(
      fc.asyncProperty(text(120), text(1000), async (name, notes) => {
        await safe(
          'customer',
          () => call('post', '/customers', { fullName: name, notes, phones: [phone()] }),
          { customer: 1 },
          async (res) => {
            const c = (await call('get', `/customers/${res.body.data.id}`)).body.data as Json;
            return [c.fullName, c.notes];
          },
          [name, notes],
        );
      }),
      { numRuns: RUNS },
    );
  }, 120_000);

  it('leads: name, interest and requirements', async () => {
    await fc.assert(
      fc.asyncProperty(text(120), text(300), text(1000), async (name, interest, requirements) => {
        await safe(
          'lead',
          () =>
            call('post', '/leads', {
              fullName: name,
              interest,
              requirements,
              phone: phone(),
              allowDuplicate: true,
            }),
          { lead: 1 },
          async (res) => {
            const l = (await call('get', `/leads/${res.body.data.id}`)).body.data as Json;
            return [l.fullName, l.interest, l.requirements];
          },
          [name, interest, requirements],
        );
      }),
      { numRuns: RUNS },
    );
  }, 120_000);

  it('tasks and notes: title, description and body', async () => {
    const customer = (
      await call('post', '/customers', { fullName: 'Holder', phones: [phone()] }).expect(201)
    ).body.data as Json;
    await fc.assert(
      fc.asyncProperty(text(150), text(1000), text(1500), async (title, description, body) => {
        await safe(
          'task',
          () => call('post', '/tasks', { type: 'TODO', title, description }),
          { task: 1 },
          async (res) => {
            const tasks = (await call('get', '/tasks?limit=100')).body.data as Json[];
            const task = tasks.find((x) => x.id === res.body.data.id) as Json;
            return [task.title, task.description];
          },
          [title, description],
        );
        await safe(
          'note',
          () =>
            call('post', '/notes', {
              entityType: 'CUSTOMER',
              entityId: customer.id,
              body,
              kind: 'NOTE',
            }),
          { note: 1 },
          async (res) => [res.body.data.body],
          [body],
        );
      }),
      { numRuns: RUNS },
    );
  }, 120_000);

  it('products, categories and suppliers: names, descriptions and notes', async () => {
    await fc.assert(
      fc.asyncProperty(
        text(150),
        text(1000),
        text(70),
        text(150),
        text(1000),
        async (name, description, category, supplier, notes) => {
          await safe(
            'product',
            () =>
              call('post', '/catalog/products', {
                type: 'NON_STOCKABLE',
                code: code(),
                name,
                description,
                basePrice: '100.00',
                variants: [{ sku: code() }],
              }),
            { product: 1 },
            async (res) => {
              const p = (await call('get', `/catalog/products/${res.body.data.id}`)).body
                .data as Json;
              return [p.name, p.description];
            },
            [name, description],
          );
          await safe(
            'category',
            () => call('post', '/catalog/categories', { name: `${category}${++seq}`.slice(0, 80) }),
            { category: 1 },
            async (res) => [res.body.data.name.startsWith(category.slice(0, 60))],
            [true],
          );
          await safe(
            'supplier',
            () => call('post', '/suppliers', { name: supplier, notes }),
            { supplier: 1 },
            async (res) => {
              const s = (await call('get', `/suppliers/${res.body.data.id}`)).body.data as Json;
              return [s.name, s.notes];
            },
            [supplier, notes],
          );
        },
      ),
      { numRuns: RUNS },
    );
  }, 180_000);

  it("quotations: notes and a custom line's name", async () => {
    const customer = (
      await call('post', '/customers', { fullName: 'Buyer', phones: [phone()] }).expect(201)
    ).body.data as Json;
    await fc.assert(
      fc.asyncProperty(text(1000), text(200), async (notes, lineName) => {
        await safe(
          'quotation',
          () =>
            call('post', '/quotations', {
              customerId: customer.id,
              notes,
              lines: [{ kind: 'CUSTOM', name: lineName, quantity: '1', unitPrice: '100' }],
            }),
          { quotation: 1 },
          async (res) => {
            const q = (await call('get', `/quotations/${res.body.data.id}`)).body.data as Json;
            return [q.notes, (q.items ?? q.lines)[0].name];
          },
          [notes, lineName],
        );
      }),
      { numRuns: RUNS },
    );
  }, 120_000);

  it('expenses: description', async () => {
    const category = (
      (await call('get', '/settings/expense-categories')).body.data as Json[]
    )[0] as Json;
    const method = ((await call('get', '/settings/payment-methods')).body.data as Json[]).find(
      (m) => m.name === 'Cash',
    ) as Json;
    await fc.assert(
      fc.asyncProperty(text(1000), async (description) => {
        const before = await snapshot();
        const res = await call(
          'post',
          '/expenses',
          {
            categoryId: category.id,
            amount: '10',
            expenseDate: '2026-03-10',
            paymentMethodId: method.id,
            description,
          },
          `exp-${++seq}`,
        );
        expect(res.status).toBe(201);
        expect((await call('get', `/expenses/${res.body.data.id}`)).body.data.description).toBe(
          description,
        );
        expect(delta(before, await snapshot())).toEqual({ expense: 1 });
      }),
      { numRuns: RUNS },
    );
  }, 120_000);

  it('templates and approved answers: names, titles and texts', async () => {
    await fc.assert(
      fc.asyncProperty(
        noBraces(60),
        noBraces(1000),
        text(150),
        text(1500),
        async (name, body, title, answer) => {
          await safe(
            'template',
            () =>
              call('post', '/templates', {
                name: `${name}${++seq}`.slice(0, 80),
                kind: 'QUICK_REPLY',
                body,
              }),
            { messageTemplate: 1 },
            async (res) => [res.body.data.body],
            [body],
          );
          await safe(
            'knowledge',
            () => call('post', '/ai/knowledge', { title, body: answer }),
            { knowledgeItem: 1 },
            async (res) => [res.body.data.title, res.body.data.body],
            [title, answer],
          );
        },
      ),
      { numRuns: RUNS },
    );
  }, 120_000);

  it('messages: what a customer sends and what staff reply are kept exactly', async () => {
    const send = (id: string, body: string) => {
      const raw = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'w',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: '4440001' },
                  contacts: [{ profile: { name: 'Sana' }, wa_id: '923001119000' }],
                  messages: [
                    {
                      from: '923001119000',
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      id,
                      type: 'text',
                      text: { body },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      return request(t.app.getHttpServer())
        .post('/api/v1/webhooks/whatsapp')
        .set('X-Forwarded-For', `10.65.${(++n >> 8) & 255}.${n & 255}`)
        .set('Content-Type', 'application/json')
        .set(
          'X-Hub-Signature-256',
          `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`,
        )
        .send(raw);
    };
    await fc.assert(
      fc.asyncProperty(text(1000), text(1000), async (incoming, reply) => {
        const id = `wamid.safety-${++seq}`;
        const before = await snapshot();
        expect((await send(id, incoming)).status).toBe(200);
        const stored = await t.db.prisma.message.findFirstOrThrow({ where: { externalId: id } });
        expect(stored.body).toBe(incoming);
        const afterIn = delta(before, await snapshot());
        expect(afterIn.message).toBe(1);
        expect(
          Object.keys(afterIn).filter((k) => !['message', 'conversation', 'lead'].includes(k)),
        ).toEqual([]);
        const sent = await call(
          'post',
          `/conversations/${stored.conversationId}/messages`,
          { body: reply },
          `safe-${seq}`,
        );
        expect(sent.status).toBe(201);
        expect(sent.body.data[0].body).toBe(reply);
      }),
      { numRuns: RUNS },
    );
  }, 120_000);

  it("a provider's message with a NUL character is received with the character removed", async () => {
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'w',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '4440001' },
                contacts: [{ profile: { name: 'Sa\u0000na' }, wa_id: '923001119001' }],
                messages: [
                  {
                    from: '923001119001',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    id: 'wamid.nul-1',
                    type: 'text',
                    text: { body: 'hel\u0000lo' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    await request(t.app.getHttpServer())
      .post('/api/v1/webhooks/whatsapp')
      .set('X-Forwarded-For', '10.64.0.1')
      .set('Content-Type', 'application/json')
      .set(
        'X-Hub-Signature-256',
        `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`,
      )
      .send(raw)
      .expect(200);
    expect(
      (await t.db.prisma.message.findFirstOrThrow({ where: { externalId: 'wamid.nul-1' } })).body,
    ).toBe('hello');
    expect(
      (
        await t.db.prisma.webhookEvent.findFirstOrThrow({
          where: { dedupeKey: 'wa:msg:wamid.nul-1' },
        })
      ).status,
    ).toBe('PROCESSED');
  });

  it('workspace settings: the business name', async () => {
    await fc.assert(
      fc.asyncProperty(text(150), async (legalName) => {
        const before = await snapshot();
        expect((await call('patch', '/settings', { business: { legalName } })).status).toBe(200);
        expect(((await call('get', '/settings')).body.data as Json).config.business.legalName).toBe(
          legalName,
        );
        expect(delta(before, await snapshot())).toEqual({});
      }),
      { numRuns: RUNS },
    );
  }, 120_000);

  it('searching for any text is safe, and a pattern character is only itself', async () => {
    const odd = [`pure% wool ${++seq}`, `under_score ${seq}`, `back\\slash ${seq}`, `quote'${seq}`];
    for (const name of odd)
      await call('post', '/customers', { fullName: name, phones: [phone()] }).expect(201);
    await fc.assert(
      fc.asyncProperty(text(80), async (q) => {
        for (const path of ['/customers', '/leads', '/catalog/products', '/suppliers']) {
          const res = await call('get', `${path}?q=${encodeURIComponent(q)}`);
          expect([path, res.status]).toEqual([path, 200]);
        }
        expect((await call('get', `/search?q=${encodeURIComponent(q)}`)).status).toBe(200);
      }),
      { numRuns: 25 },
    );
    // "%" does not mean "anything" and "_" does not mean "any one character"
    const find = async (q: string) =>
      (
        (await call('get', `/customers?q=${encodeURIComponent(q)}&limit=100`)).body.data as Json[]
      ).map((c) => c.fullName);
    expect(await find('pure%')).toEqual([odd[0]]);
    expect(await find('pure%wool')).toEqual([]); // % is not "anything"
    expect(await find('under_score')).toEqual([odd[1]]);
    expect(await find('under%score')).toEqual([]);
    expect(await find('back\\slash')).toEqual([odd[2]]);
    expect(await find("quote'")).toEqual([odd[3]]);
  }, 120_000);

  it('a character the database cannot hold is refused as a bad request, not a crash', async () => {
    for (const bad of ['a\u0000b', '\u0000']) {
      const before = await snapshot();
      const res = await call('post', '/customers', { fullName: bad, phones: [phone()] });
      expect([bad, res.status]).toEqual([bad, 400]);
      expect(delta(before, await snapshot())).toEqual({});
    }
    expect(
      (await call('post', '/leads', { fullName: 'Fine', interest: 'a\u0000b', phone: phone() }))
        .status,
    ).toBe(400);
    expect((await call('get', `/customers?q=${encodeURIComponent('a\u0000b')}`)).status).toBe(400);
    expect(workspaceId).toBeTruthy();
  });
});
