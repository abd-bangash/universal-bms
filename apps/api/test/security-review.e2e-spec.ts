import { createHmac } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { RequirePermission } from '../src/common/decorators/require-permission.decorator';
import { LOGGER } from '../src/common/logging/app-logger';
import { createLogger } from '../src/common/logging/logger';
import { ChannelRegistry } from '../src/modules/channels/channel.registry';
import { WhatsAppAdapter } from '../src/modules/channels/whatsapp/whatsapp.adapter';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

/** Routes that fail in the ways a real route might, so what the client is told can be looked at. */
@Controller('test-failures')
class FailureProbeController {
  @Get('crash')
  @RequirePermission('workspace:view')
  crash(): never {
    throw new Error(
      "duplicate key value violates unique constraint at /home/user/universal-bms/apps/api/src/x.ts: SELECT * FROM users WHERE email = 'secret@example.test'",
    );
  }

  @Get('prisma')
  @RequirePermission('workspace:view')
  prisma(): never {
    throw new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`email`) while running INSERT INTO "users"',
      { code: 'P2002', clientVersion: 'x', meta: { target: ['email'] } },
    );
  }

  @Get('typeerror')
  @RequirePermission('workspace:view')
  typeError(): never {
    return (undefined as unknown as { boom(): never }).boom();
  }
}

const SECRETS = {
  password: 'Sup3r-Secret-Passw0rd!',
  wrongPassword: 'Wr0ng-Passw0rd-555!',
  whatsappToken: 'EAAG-SECRET-WHATSAPP-TOKEN-777',
  aiKey: 'sk-ant-SECRET-KEY-99999',
  email: 'private.person@example.test',
  phoneDigits: '311555999',
  address: '12 Hidden Street Karachi',
  message: 'my very private message body',
  appSecret: 'meta-app-secret-for-review',
};

describe('Security review', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  const lines: string[] = [];
  let n = 0;
  let owner: string;

  beforeAll(async () => {
    const sink = { write: (chunk: string) => void lines.push(chunk) };
    t = await createTestApp(
      { META_APP_SECRET: SECRETS.appSecret },
      {
        controllers: [FailureProbeController],
        overrides: [{ provide: LOGGER, useValue: createLogger('trace', sink) }],
      },
    );
    http = api(t.app);
    const email = 'owner@review.test';
    await t.app.get(TenantsService).createWorkspace({
      name: 'Review',
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: SECRETS.password },
      currency: 'PKR',
      country: 'PK',
    });
    owner = (await http.post('/auth/login', { email, password: SECRETS.password }).expect(200)).body
      .data.accessToken as string;
  }, 90_000);
  afterAll(() => t.close());

  const ip = () => `10.55.${(++n >> 8) & 255}.${n & 255}`;
  const get = (path: string, token = owner) =>
    request(t.app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', ip());

  describe('logs hold no secret or personal data (Requirement 20.8)', () => {
    it('after logging in, connecting services, handling customers and messages, and failing at all of it', async () => {
      // credentials, a wrong password, a reset request
      await http
        .post('/auth/login', { email: 'owner@review.test', password: SECRETS.wrongPassword })
        .expect(401);
      await http
        .post('/auth/password/forgot', { email: 'owner@review.test' })
        .catch(() => undefined);
      // connections with secrets
      await http
        .post(
          '/integrations',
          {
            provider: 'WHATSAPP',
            values: { phoneNumberId: '7770001', accessToken: SECRETS.whatsappToken },
          },
          owner,
        )
        .expect(201);
      await http
        .post('/integrations', { provider: 'ANTHROPIC', values: { apiKey: SECRETS.aiKey } }, owner)
        .expect(201);
      // personal data in, and out
      const customer = (
        await http
          .post(
            '/customers',
            {
              fullName: 'Private Person',
              email: SECRETS.email,
              phones: [`+92 ${SECRETS.phoneDigits}`.replace(' ', '')],
              billingAddress: { line1: SECRETS.address },
            },
            owner,
          )
          .expect(201)
      ).body.data as Json;
      await get(`/customers/${customer.id}`).expect(200);
      await get(`/customers?q=${encodeURIComponent(SECRETS.email)}`).expect(200);
      await get(`/search?q=${SECRETS.phoneDigits}`).expect(200);
      // errors that carry the same data
      await http
        .post(
          '/customers',
          { fullName: 'Dup', email: 'not-an-email', phones: [`+92${SECRETS.phoneDigits}`] },
          owner,
        )
        .expect(400);
      await http
        .post(
          '/customers',
          {
            fullName: 'Dup',
            email: SECRETS.email,
            phones: [`+92${SECRETS.phoneDigits}`],
            unexpected: SECRETS.message,
          },
          owner,
        )
        .expect(400);
      // a message arriving and a reply going out
      jest
        .spyOn(t.app.get(WhatsAppAdapter), 'sendMessage')
        .mockRejectedValue(
          Object.assign(new Error(`token ${SECRETS.whatsappToken} rejected`), { status: 401 }),
        );
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
                  metadata: { phone_number_id: '7770001' },
                  contacts: [
                    { profile: { name: 'Private Person' }, wa_id: `92${SECRETS.phoneDigits}` },
                  ],
                  messages: [
                    {
                      from: `92${SECRETS.phoneDigits}`,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      id: 'wamid.review-1',
                      type: 'text',
                      text: { body: SECRETS.message },
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
        .set('X-Forwarded-For', ip())
        .set('Content-Type', 'application/json')
        .set(
          'X-Hub-Signature-256',
          `sha256=${createHmac('sha256', SECRETS.appSecret).update(raw).digest('hex')}`,
        )
        .send(raw)
        .expect(200);
      await request(t.app.getHttpServer())
        .post('/api/v1/webhooks/whatsapp')
        .set('X-Forwarded-For', ip())
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', 'sha256=bad')
        .send(raw)
        .expect(401);
      const conversation = await t.db.prisma.conversation.findFirstOrThrow({});
      await request(t.app.getHttpServer())
        .post(`/api/v1/conversations/${conversation.id}/messages`)
        .set('Authorization', `Bearer ${owner}`)
        .set('X-Forwarded-For', ip())
        .set('Idempotency-Key', 'review-1')
        .send({ body: SECRETS.message })
        .expect(201); // the send fails; the reply is stored as failed
      // crashes
      for (const path of ['crash', 'prisma', 'typeerror'])
        await get(`/test-failures/${path}`).expect(500);

      const log = lines.join('');
      expect(log).toContain('request completed'); // the log is not empty
      expect(log.length).toBeGreaterThan(2000);
      const found = Object.entries(SECRETS)
        .filter(([, value]) => log.includes(value))
        .map(([name]) => name);
      expect(found).toEqual([]);
      expect(log).not.toContain(owner); // the access token itself
      expect(log).not.toContain('passwordHash');
      expect(log).not.toMatch(/\$argon2|\$2[aby]\$/);
    });
  });

  describe('error responses carry no internals (Requirement 20.10)', () => {
    const internals = [
      /node_modules/,
      /\/home\//,
      /\.ts:\d+/,
      /\bat [\w.<>]+ \(/,
      /SELECT\s/i,
      /INSERT\s/i,
      /prisma/i,
      /stack/i,
      /Unique constraint/i,
      /secret@example/,
    ];

    it.each(['crash', 'prisma', 'typeerror'])(
      'an unexpected failure (%s) is told as a plain 500',
      async (kind) => {
        const res = await get(`/test-failures/${kind}`).expect(500);
        expect(Object.keys(res.body).sort()).toEqual([
          'code',
          'message',
          'requestId',
          'statusCode',
        ]);
        expect(res.body).toMatchObject({
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        });
        for (const re of internals)
          expect([kind, re.source, re.test(res.text)]).toEqual([kind, re.source, false]);
      },
    );

    it('every kind of client error is plain too', async () => {
      const responses = [
        await get('/no-such-route'),
        await request(t.app.getHttpServer())
          .post('/api/v1/customers')
          .set('Authorization', `Bearer ${owner}`)
          .set('X-Forwarded-For', ip())
          .set('Content-Type', 'application/json')
          .send('{"broken'),
        await request(t.app.getHttpServer())
          .post('/api/v1/customers')
          .set('Authorization', `Bearer ${owner}`)
          .set('X-Forwarded-For', ip())
          .send({ fullName: 5, phones: 'x' }),
        await get('/customers/does-not-exist'),
        await get('/customers', 'not-a-token'),
        await request(t.app.getHttpServer())
          .post('/api/v1/customers')
          .set('Authorization', `Bearer ${owner}`)
          .set('X-Forwarded-For', ip())
          .set('Content-Type', 'application/json')
          .send(JSON.stringify({ fullName: 'x'.repeat(2_000_000) })),
      ];
      expect(responses.map((r) => r.status)).toEqual([404, 400, 400, 404, 401, 413]);
      for (const res of responses) {
        for (const re of internals)
          expect([res.status, re.source, re.test(res.text)]).toEqual([
            res.status,
            re.source,
            false,
          ]);
        expect(res.body.requestId ?? res.body.error).toBeDefined();
      }
    });

    it('no response carries a password hash, a stored secret or a token it was not asked for', async () => {
      const bodies = [
        (await get('/auth/me')).text,
        (await get('/users')).text,
        (await get('/roles')).text,
        (await get('/integrations')).text,
        (await get('/settings')).text,
      ].join('\n');
      for (const secret of [
        SECRETS.whatsappToken,
        SECRETS.aiKey,
        SECRETS.password,
        'passwordHash',
        'configEncrypted',
        'tokenHash',
      ]) {
        expect([secret, bodies.includes(secret)]).toEqual([secret, false]);
      }
    });
  });

  describe('every response carries the security headers (Requirement 20.9)', () => {
    it.each([
      ['an answer', () => get('/auth/me')],
      ['a refusal', () => get('/auth/me', 'bad')],
      ['a miss', () => get('/nothing-here')],
      ['a public route', () => request(t.app.getHttpServer()).get('/api/v1/health/live')],
    ] as const)('on %s', async (_label, send) => {
      const res = await send();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(
        res.headers['x-frame-options'] ?? res.headers['content-security-policy'],
      ).toBeDefined();
      expect(res.headers['referrer-policy']).toBeDefined();
    });
  });

  describe('every webhook verifies its signature (Requirement 20.4)', () => {
    it('refuses an unsigned or wrongly signed delivery on every provider that is installed', async () => {
      const providers = t.app
        .get(ChannelRegistry)
        .all()
        .map((a) => a.provider);
      expect(providers.length).toBeGreaterThan(0);
      for (const provider of providers) {
        const path = `/api/v1/webhooks/${provider.toLowerCase()}`;
        const body = JSON.stringify({ object: 'x', entry: [] });
        for (const header of [
          undefined,
          'sha256=00',
          `sha256=${createHmac('sha256', 'wrong').update(body).digest('hex')}`,
        ]) {
          const req = request(t.app.getHttpServer())
            .post(path)
            .set('X-Forwarded-For', ip())
            .set('Content-Type', 'application/json');
          if (header) req.set('X-Hub-Signature-256', header);
          expect([provider, header, (await req.send(body)).status]).toEqual([
            provider,
            header,
            401,
          ]);
        }
      }
    });
  });

  describe('rate limits are on (Requirement 20.3)', () => {
    // a fresh application, so no earlier request has used up part of a minute's allowance
    let r: TestApp;
    let owner2: string;
    beforeAll(async () => {
      r = await createTestApp({ META_APP_SECRET: SECRETS.appSecret });
      const email = 'owner@limits.test';
      await r.app.get(TenantsService).createWorkspace({
        name: 'Limits',
        industryProfile: 'furniture',
        owner: { email, firstName: 'O', lastName: 'O', password: SECRETS.password },
      });
      owner2 = (
        await api(r.app).post('/auth/login', { email, password: SECRETS.password }).expect(200)
      ).body.data.accessToken as string;
    }, 90_000);
    afterAll(() => r.close());

    it('sign-in attempts from one address: 10 a minute, across all the sign-in routes', async () => {
      const address = '10.200.0.1';
      const post = (path: string) =>
        request(r.app.getHttpServer())
          .post(`/api/v1${path}`)
          .set('X-Forwarded-For', address)
          .send({ email: 'nobody@limits.test', password: 'x'.repeat(12) });
      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) statuses.push((await post('/auth/login')).status);
      for (let i = 0; i < 6; i += 1) statuses.push((await post('/auth/password/forgot')).status);
      expect(statuses.slice(0, 6).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(6, 10).every((s) => s !== 429)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]); // the 11th and 12th, whichever route they went to
      const limited = await post('/auth/login');
      expect(limited.headers['retry-after']).toBeDefined();
      expect(limited.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
      // another address is not affected
      expect(
        (
          await request(r.app.getHttpServer())
            .post('/api/v1/auth/login')
            .set('X-Forwarded-For', '10.200.0.2')
            .send({ email: 'nobody@limits.test', password: 'x'.repeat(12) })
        ).status,
      ).toBe(401);
    });

    it('webhooks: 600 a minute for a provider, whoever sends them', async () => {
      let first429 = -1;
      for (let i = 0; i < 610; i += 1) {
        const res = await request(r.app.getHttpServer())
          .post('/api/v1/webhooks/whatsapp')
          .set('X-Forwarded-For', `10.201.${(i >> 8) & 255}.${i & 255}`)
          .set('Content-Type', 'application/json')
          .send('{}');
        if (res.status === 429 && first429 < 0) first429 = i;
      }
      expect(first429).toBe(600);
    }, 120_000);

    it('everything else: 300 a minute for a person, across all routes, from any address', async () => {
      let first429 = -1;
      for (let i = 0; i < 305; i += 1) {
        const res = await request(r.app.getHttpServer())
          .get(i % 2 === 0 ? '/api/v1/auth/me' : '/api/v1/roles')
          .set('Authorization', `Bearer ${owner2}`)
          .set('X-Forwarded-For', `10.202.${(i >> 8) & 255}.${i & 255}`);
        if (res.status === 429 && first429 < 0) first429 = i;
      }
      expect(first429).toBe(300);
    }, 120_000);
  });
});
