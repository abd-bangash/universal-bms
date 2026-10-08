import { Controller, Get } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../src/common/context/request-context';
import type { Logger } from 'pino';
import request from 'supertest';
import { ENV, type Env } from '../src/config/env';
import { LOGGER } from '../src/common/logging/app-logger';
import { RequirePermission } from '../src/common/decorators/require-permission.decorator';
import {
  AdapterRunner,
  ProviderHttpError,
  normalizeError,
} from '../src/modules/integrations/adapter-runner';
import { IntegrationProviderRegistry } from '../src/modules/integrations/integration-provider.registry';
import { decryptJson } from '../src/modules/integrations/secret-box';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

const SECRET = 'EAAG-super-secret-token-9876';
const RAW_FAILURE =
  'Invalid OAuth access token EAAG-super-secret-token-9876 at https://graph.example/v1';

/** A route that lets the HTTP envelope of a failed adapter call be inspected. */
let lastRunner: AdapterRunner;
@Controller('test-adapter')
class AdapterProbeController {
  constructor(
    runner: AdapterRunner,
    private readonly cls: ClsService,
  ) {
    lastRunner = runner;
  }
  @Get()
  @RequirePermission('integration:manage')
  async probe() {
    return lastRunner.run('FAKE_CHANNEL', 'send', async () => {
      throw new Error(RAW_FAILURE);
    });
  }
}

describe('Integrations (real PostgreSQL)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;
  let behaviour: () => Promise<{ ok: boolean; detail?: string }> = async () => ({
    ok: true,
    detail: 'Verified',
  });
  const logLines: string[] = [];

  beforeAll(async () => {
    t = await createTestApp({}, { controllers: [AdapterProbeController] });
    http = api(t.app);
    t.app.get(IntegrationProviderRegistry).register({
      provider: 'FAKE_CHANNEL',
      type: 'CHANNEL',
      label: 'Fake channel',
      accountIdField: 'accountId',
      fields: [
        { key: 'accountId', label: 'Account id', secret: false, required: true },
        { key: 'accessToken', label: 'Access token', secret: true, required: true },
        { key: 'note', label: 'Note', secret: false, required: false },
      ],
      test: () => behaviour(),
    });
    // everything the application logs, to prove the credentials are never in it
    const logger = t.app.get<Logger>(LOGGER);
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      const original = logger[level].bind(logger);
      (logger as unknown as Record<string, unknown>)[level] = (...args: unknown[]) => {
        logLines.push(
          JSON.stringify(args, (_k, v) =>
            v instanceof Error ? { message: v.message, stack: v.stack } : v,
          ),
        );
        return (original as (...a: unknown[]) => void)(...args);
      };
    }
  }, 90_000);
  afterAll(() => t.close());

  async function business() {
    const email = `owner${++n}@int.test`;
    const created = await t.app.get(TenantsService).createWorkspace({
      name: `Int ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      country: 'PK',
    });
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const roles = (await http.get('/roles', token)).body.data as Json[];
    return { ...created, token, roles };
  }
  const connect = (b: { token: string }, values: Json = {}, provider = 'FAKE_CHANNEL') =>
    request(t.app.getHttpServer())
      .post('/api/v1/integrations')
      .set('Authorization', `Bearer ${b.token}`)
      .send({
        provider,
        displayName: 'Showroom',
        values: { accountId: `acct-${n}-${Math.random()}`, accessToken: SECRET, ...values },
      });
  const post = (b: { token: string }, path: string) =>
    request(t.app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({});

  describe('connecting', () => {
    it('stores the credentials encrypted and shows them masked everywhere', async () => {
      const b = await business();
      const res = await connect(b).expect(201);
      const dto = res.body.data as Json;
      expect(dto).toMatchObject({
        provider: 'FAKE_CHANNEL',
        status: 'CONNECTED',
        displayName: 'Showroom',
      });
      expect(dto.fields.find((f: Json) => f.key === 'accessToken')).toMatchObject({
        secret: true,
        value: '••••9876',
      });
      expect(dto.fields.find((f: Json) => f.key === 'accountId').value).toMatch(/^acct-/);

      for (const url of ['/integrations', `/integrations/${dto.id}`]) {
        expect(JSON.stringify((await http.get(url, b.token)).body)).not.toContain(SECRET);
      }
      const stored = await t.db.prisma.integrationConnection.findFirstOrThrow({
        where: { id: dto.id },
      });
      expect(stored.configEncrypted.split(':')).toHaveLength(3);
      expect(stored.configEncrypted).not.toContain('super-secret');
      expect(
        decryptJson(t.app.get<Env>(ENV).INTEGRATION_ENCRYPTION_KEY, stored.configEncrypted),
      ).toMatchObject({
        accessToken: SECRET,
      });
    });

    it('never puts the credentials in the audit trail or the logs', async () => {
      const b = await business();
      logLines.length = 0;
      const dto = (await connect(b).expect(201)).body.data as Json;
      behaviour = async () => {
        throw new ProviderHttpError(401, RAW_FAILURE);
      };
      await post(b, `/integrations/${dto.id}/test`).expect(200);
      behaviour = async () => ({ ok: true });
      await post(b, `/integrations/${dto.id}/disconnect`).expect(200);
      const events = await t.db.prisma.auditEvent.findMany({
        where: { workspaceId: b.workspaceId },
      });
      expect(JSON.stringify(events)).not.toContain(SECRET);
      expect(events.map((e) => e.action)).toEqual(
        expect.arrayContaining([
          'integration.connect',
          'integration.error',
          'integration.disconnect',
        ]),
      );
      expect(logLines.join('\n')).not.toContain(SECRET);
      expect(logLines.join('\n')).not.toContain('graph.example');
    });

    it('reconnecting replaces the credentials and clears the last error', async () => {
      const b = await business();
      const first = (await connect(b, { accountId: 'acct-same' }).expect(201)).body.data as Json;
      const again = (
        await connect(b, { accountId: 'acct-same', accessToken: 'new-token-0000' }).expect(201)
      ).body.data as Json;
      expect(again.id).toBe(first.id);
      expect(again.fields.find((f: Json) => f.key === 'accessToken').value).toBe('••••0000');
      expect(
        await t.db.prisma.integrationConnection.count({ where: { workspaceId: b.workspaceId } }),
      ).toBe(1);
    });

    it('checks the provider, the required settings and unknown keys', async () => {
      const b = await business();
      await connect(b, {}, 'NOPE').expect(400);
      const res = await request(t.app.getHttpServer())
        .post('/api/v1/integrations')
        .set('Authorization', `Bearer ${b.token}`)
        .send({ provider: 'FAKE_CHANNEL', values: { accessToken: 'x', stray: 'y' } })
        .expect(400);
      expect(res.body.details).toMatchObject({
        accountId: ['is required'],
        stray: ['is not a setting of this provider'],
      });
    });

    it('one account cannot be connected twice anywhere, and the refusal does not say where (42.1)', async () => {
      const a = await business();
      const other = await business();
      await connect(a, { accountId: 'shared-account' }).expect(201);
      const res = await connect(other, { accountId: 'shared-account' }).expect(422);
      expect(JSON.stringify(res.body)).not.toContain(a.workspaceId);
      expect(res.body.message).toMatch(/already connected/);
    });
  });

  describe('testing and failures', () => {
    it('reports success with the time of the last success', async () => {
      const b = await business();
      const dto = (await connect(b).expect(201)).body.data as Json;
      behaviour = async () => ({ ok: true, detail: 'Verified +92 300 1234567' });
      const res = (await post(b, `/integrations/${dto.id}/test`).expect(200)).body.data as Json;
      expect(res).toEqual({ ok: true, detail: 'Verified +92 300 1234567' });
      const after = (await http.get(`/integrations/${dto.id}`, b.token)).body.data as Json;
      expect(after.lastSuccessAt).not.toBeNull();
      expect(after.status).toBe('CONNECTED');
    });

    it('turns any adapter exception into a normalized code, records it, and never shows the provider text (48.6)', async () => {
      const b = await business();
      const dto = (await connect(b).expect(201)).body.data as Json;
      const expectations: Array<[() => Promise<never>, string]> = [
        [
          async () => {
            throw new ProviderHttpError(401, RAW_FAILURE);
          },
          'AUTH_FAILED',
        ],
        [
          async () => {
            throw new ProviderHttpError(429, RAW_FAILURE);
          },
          'RATE_LIMITED',
        ],
        [
          async () => {
            throw new ProviderHttpError(503, RAW_FAILURE);
          },
          'PROVIDER_ERROR',
        ],
        [
          async () => {
            throw new Error(RAW_FAILURE);
          },
          'UNKNOWN',
        ],
      ];
      for (const [fail, code] of expectations) {
        behaviour = fail;
        const res = await post(b, `/integrations/${dto.id}/test`).expect(200);
        expect(res.body.data).toEqual({ ok: false, code });
        expect(JSON.stringify(res.body)).not.toContain('OAuth');
      }
      const after = (await http.get(`/integrations/${dto.id}`, b.token)).body.data as Json;
      expect(after).toMatchObject({ status: 'ERROR', lastError: 'UNKNOWN' });
      expect(after.lastErrorAt).not.toBeNull();
      // only the first failure of a run is an Audit_Event
      expect(
        await t.db.prisma.auditEvent.count({
          where: { workspaceId: b.workspaceId, action: 'integration.error' },
        }),
      ).toBe(1);
      behaviour = async () => ({ ok: true });
      await post(b, `/integrations/${dto.id}/test`).expect(200);
      expect(((await http.get(`/integrations/${dto.id}`, b.token)).body.data as Json).status).toBe(
        'CONNECTED',
      );
    });

    it('an adapter exception on a normal request surfaces as EXTERNAL_SERVICE_FAILED with a code, not the provider text', async () => {
      const b = await business();
      const res = await http.get('/test-adapter', b.token).expect(502);
      expect(res.body).toMatchObject({
        code: 'EXTERNAL_SERVICE_FAILED',
        message: 'An external service failed',
        data: { provider: 'FAKE_CHANNEL', normalizedCode: 'UNKNOWN' },
      });
      expect(JSON.stringify(res.body)).not.toContain('OAuth');
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });

    it('credentials that cannot be decrypted are refused with an instruction, not a crash', async () => {
      const b = await business();
      const dto = (await connect(b).expect(201)).body.data as Json;
      await t.db.prisma.integrationConnection.update({
        where: { id: dto.id },
        data: { configEncrypted: 'AAAA:BBBB:CCCC' },
      });
      const res = await post(b, `/integrations/${dto.id}/test`).expect(422);
      expect(res.body.message).toMatch(/connect this provider again/);
      expect(
        (
          (await http.get('/integrations', b.token)).body.data.connections as Json[]
        )[0].fields.every((f: Json) => f.value === ''),
      ).toBe(true);
    });
  });

  describe('AdapterRunner', () => {
    it('maps every kind of failure to one of a few codes', () => {
      expect(normalizeError(new ProviderHttpError(400))).toBe('BAD_REQUEST');
      expect(normalizeError(new ProviderHttpError(403))).toBe('AUTH_FAILED');
      expect(normalizeError(Object.assign(new Error(RAW_FAILURE), { code: 'ECONNREFUSED' }))).toBe(
        'NETWORK_ERROR',
      );
      expect(normalizeError(Object.assign(new Error(RAW_FAILURE), { code: 'ENOTFOUND' }))).toBe(
        'NETWORK_ERROR',
      );
      expect(normalizeError('a string')).toBe('UNKNOWN');
      expect(normalizeError(null)).toBe('UNKNOWN');
    });

    const inWorkspace = <T>(workspaceId: string, fn: () => Promise<T>) =>
      t.app.get(ClsService<RequestContext>).runWith({ workspaceId }, fn);

    it('times out a slow call', async () => {
      const runner = t.app.get(AdapterRunner);
      const started = Date.now();
      await expect(
        inWorkspace('ws-timeout', () =>
          runner.run('SLOW', 'send', () => new Promise(() => undefined), { timeoutMs: 50 }),
        ),
      ).rejects.toMatchObject({ provider: 'SLOW', normalizedCode: 'TIMEOUT' });
      expect(Date.now() - started).toBeLessThan(2000);
    });

    it('retries only when asked to, and returns the result of a retry that works', async () => {
      const runner = t.app.get(AdapterRunner);
      let calls = 0;
      const flaky = async () => {
        calls += 1;
        if (calls < 2) throw new ProviderHttpError(503);
        return 'ok';
      };
      await expect(
        inWorkspace('ws-retry', () => runner.run('RETRY', 'read', flaky)),
      ).rejects.toMatchObject({ normalizedCode: 'PROVIDER_ERROR' });
      calls = 0;
      await expect(
        inWorkspace('ws-retry2', () => runner.run('RETRY', 'read', flaky, { retries: 2 })),
      ).resolves.toBe('ok');
    });

    it('opens the circuit after repeated failures, so later calls fail fast without reaching the provider', async () => {
      const runner = t.app.get(AdapterRunner);
      let reached = 0;
      const down = async () => {
        reached += 1;
        throw new ProviderHttpError(500);
      };
      for (let i = 0; i < 5; i += 1) {
        await expect(
          inWorkspace('ws-circuit', () => runner.run('DOWN', 'send', down)),
        ).rejects.toMatchObject({ normalizedCode: 'PROVIDER_ERROR' });
      }
      expect(runner.circuitOpen('DOWN', 'ws-circuit')).toBe(true);
      await expect(
        inWorkspace('ws-circuit', () => runner.run('DOWN', 'send', down)),
      ).rejects.toMatchObject({ normalizedCode: 'CIRCUIT_OPEN', status: 503 });
      expect(reached).toBe(5);
      // another workspace's circuit is its own
      await expect(
        inWorkspace('ws-other', () => runner.run('DOWN', 'send', async () => 'fine')),
      ).resolves.toBe('fine');
    });
  });

  describe('who may do what', () => {
    it('needs integration:manage to connect, test or disconnect, and integration:view to look', async () => {
      const b = await business();
      const dto = (await connect(b).expect(201)).body.data as Json;
      const role = (
        await http
          .post(
            '/roles',
            { name: 'Integration watcher', permissions: ['integration:view'] },
            b.token,
          )
          .expect(201)
      ).body.data;
      const email = `watcher${++n}@int.test`;
      const invite = await http
        .post('/users/invite', { email, roleIds: [role.id] }, b.token)
        .expect(201);
      await http
        .post('/auth/invite/accept', {
          token: invite.body.data.token,
          password: 'watcher-pass-1',
          firstName: 'W',
          lastName: 'W',
        })
        .expect(200);
      const watcher = {
        token: (await http.post('/auth/login', { email, password: 'watcher-pass-1' }).expect(200))
          .body.data.accessToken as string,
      };
      await http.get('/integrations', watcher.token).expect(200);
      await connect(watcher).expect(403);
      await post(watcher, `/integrations/${dto.id}/test`).expect(403);
      await post(watcher, `/integrations/${dto.id}/disconnect`).expect(403);
      const sales = b.roles.find((r) => r.name === 'Salesperson') as Json;
      const invite2 = await http
        .post('/users/invite', { email: `sales${++n}@int.test`, roleIds: [sales.id] }, b.token)
        .expect(201);
      expect(invite2.status).toBe(201);
    });

    it("another workspace cannot see, test or disconnect this one's connection", async () => {
      const a = await business();
      const other = await business();
      const dto = (await connect(a).expect(201)).body.data as Json;
      await http.get(`/integrations/${dto.id}`, other.token).expect(404);
      await post(other, `/integrations/${dto.id}/test`).expect(404);
      await post(other, `/integrations/${dto.id}/disconnect`).expect(404);
      expect((await http.get('/integrations', other.token)).body.data.connections).toEqual([]);
    });
  });

  describe('disconnecting', () => {
    it('forgets the credentials, keeps the record, and refuses further tests', async () => {
      const b = await business();
      const dto = (await connect(b).expect(201)).body.data as Json;
      const off = (await post(b, `/integrations/${dto.id}/disconnect`).expect(200)).body
        .data as Json;
      expect(off).toMatchObject({ status: 'DISCONNECTED', externalAccountId: null });
      expect(off.fields.every((f: Json) => f.value === '')).toBe(true);
      const stored = await t.db.prisma.integrationConnection.findFirstOrThrow({
        where: { id: dto.id },
      });
      expect(stored.configEncrypted).not.toContain(SECRET);
      await post(b, `/integrations/${dto.id}/test`).expect(422);
      // and the account is free to be connected again
      await connect(b, { accountId: 'fresh-account' }).expect(201);
    });
  });
});
