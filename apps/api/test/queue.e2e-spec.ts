import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { ClsService } from 'nestjs-cls';
import request from 'supertest';
import { QueueRegistry } from '../src/modules/queue/queue.registry';
import { QueueService } from '../src/modules/queue/queue.service';
import type { QueueName } from '../src/modules/queue/queue.types';
import { SettingsService } from '../src/modules/settings/settings.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { runWithWorkspace } from './helpers/context';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

const REDIS = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';

describe('Queues (real Redis)', () => {
  const prefixes: string[] = [];
  const apps: TestApp[] = [];

  afterAll(async () => {
    for (const a of apps) await a.close();
    const redis = new IORedis(REDIS);
    for (const prefix of prefixes) {
      const keys = await redis.keys(`${prefix}:*`);
      if (keys.length > 0) await redis.del(...keys);
    }
    redis.disconnect();
  });

  async function boot(env: Record<string, unknown> = {}) {
    const prefix = `bms-test-${randomUUID()}`;
    prefixes.push(prefix);
    const t = await createTestApp({
      QUEUE_MODE: 'redis',
      QUEUE_PREFIX: prefix,
      REDIS_URL: REDIS,
      ...env,
    } as never);
    apps.push(t);
    return t;
  }

  /** Registers a processor on a queue the application does not otherwise use. */
  function processor(
    t: TestApp,
    queue: QueueName,
    handler: (
      payload: Json,
      info: { attemptsMade: number },
      workspaceId: string | undefined,
    ) => Promise<void>,
    attempts = 3,
    start = true,
  ) {
    const cls = t.app.get(ClsService);
    t.app.get(QueueRegistry).register({
      queue,
      attempts,
      backoffMs: 10,
      concurrency: 1,
      handler: (payload, job) =>
        handler(payload, job, cls.get('workspaceId') as string | undefined),
    });
    if (start) t.app.get(QueueService).startWorkers();
  }
  const until = async (check: () => boolean | Promise<boolean>, ms = 8000) => {
    const end = Date.now() + ms;
    while (!(await check())) {
      if (Date.now() > end) throw new Error('condition not met in time');
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  it('runs a job inside the workspace it names, with the person who asked', async () => {
    const t = await boot();
    const seen: Array<[string | undefined, unknown]> = [];
    processor(t, 'email.send', async (payload, _job, workspaceId) => {
      seen.push([workspaceId, payload['to']]);
    });
    await t.app
      .get(QueueService)
      .add('email.send', 'send', { workspaceId: 'ws-a', to: 'a@x.test' });
    await t.app
      .get(QueueService)
      .add('email.send', 'send', { workspaceId: 'ws-b', to: 'b@x.test' });
    await until(() => seen.length === 2);
    expect(seen).toEqual(
      expect.arrayContaining([
        ['ws-a', 'a@x.test'],
        ['ws-b', 'b@x.test'],
      ]),
    );
  });

  it('refuses a job that does not say which workspace it is for', async () => {
    const t = await boot();
    await expect(
      t.app.get(QueueService).add('email.send', 'send', { to: 'x' } as never),
    ).rejects.toThrow(/workspace/);
  });

  it('retries a failing job with a delay and does not dead-letter one that recovers', async () => {
    const t = await boot();
    const attempts: number[] = [];
    processor(t, 'report.generate', async (_p, job) => {
      attempts.push(job.attemptsMade);
      if (job.attemptsMade < 2) throw new Error('flaky');
    });
    const queues = t.app.get(QueueService);
    await queues.add('report.generate', 'run', { workspaceId: 'ws-1' });
    await until(() => attempts.length === 3);
    await queues.idle('report.generate');
    expect(attempts).toEqual([0, 1, 2]);
    expect(await queues.deadLetters()).toEqual([]);
  });

  it('moves a job that keeps failing to the dead-letter queue with what it was and why', async () => {
    const t = await boot();
    let tries = 0;
    processor(t, 'channel.outbound', async () => {
      tries += 1;
      throw new Error('provider said no');
    });
    const queues = t.app.get(QueueService);
    await queues.add('channel.outbound', 'send', { workspaceId: 'ws-9', messageId: 'm1' });
    await until(async () => (await queues.deadLetters()).length === 1);
    expect(tries).toBe(3);
    expect((await queues.deadLetters())[0]).toMatchObject({
      queue: 'channel.outbound',
      jobName: 'send',
      payload: { workspaceId: 'ws-9', messageId: 'm1' },
      error: 'provider said no',
      attempts: 3,
    });
    expect((await queues.stats())['dead-letter']?.waiting).toBe(1);
  });

  it('does no work in this process when workers are switched off, and a worker started later picks the job up (WORKERS_IN_PROCESS)', async () => {
    const t = await boot({ WORKERS_IN_PROCESS: false });
    const done: string[] = [];
    processor(
      t,
      'ai.process',
      async (payload) => {
        done.push(String(payload['id']));
      },
      3,
      false,
    );
    const queues = t.app.get(QueueService);
    await queues.add('ai.process', 'think', { workspaceId: 'ws-1', id: 'j1' });
    await new Promise((r) => setTimeout(r, 300));
    expect(done).toEqual([]);
    expect((await queues.stats())['ai.process']?.waiting).toBe(1);
    queues.startWorkers(); // what a separate worker process does
    await queues.idle('ai.process');
    expect(done).toEqual(['j1']);
  });

  it('commission calculation goes through the queue and still produces the commission', async () => {
    const t = await boot();
    const http = api(t.app);
    const email = 'owner@queue-commission.test';
    const created = await t.app.get(TenantsService).createWorkspace({
      name: 'Queue Co',
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      country: 'PK',
    });
    await runWithWorkspace(t.app, created.workspaceId, () =>
      t.app.get(SettingsService).update({ sales: { requiredDepositPercent: 0 } }),
    );
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const me = (await http.get('/auth/me', token)).body.data.user.id as string;
    await request(t.app.getHttpServer())
      .put(`/api/v1/staff/${me}/commission`)
      .set('Authorization', `Bearer ${token}`)
      .send({ percent: '10' })
      .expect(200);
    const product = (
      await http
        .post(
          '/catalog/products',
          {
            type: 'NON_STOCKABLE',
            code: 'S',
            name: 'Sofa',
            basePrice: '1000',
            variants: [{ sku: 'S-1' }],
          },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const customer = (
      await http
        .post('/customers', { fullName: 'Q Buyer', phones: ['0300-5550123'] }, token)
        .expect(201)
    ).body.data as Json;
    const order = (
      await request(t.app.getHttpServer())
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'q-1')
        .send({
          customerId: customer.id,
          lines: [{ variantId: product.variants[0].id, quantity: '2' }],
        })
        .expect(201)
    ).body.data as Json;
    for (const status of [
      'confirmed',
      'in_production',
      'ready',
      'out_for_delivery',
      'delivered',
      'completed',
    ]) {
      await request(t.app.getHttpServer())
        .post(`/api/v1/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status })
        .expect(200);
    }
    await t.app.get(QueueService).idle('commission.calculate');
    await until(async () => (await http.get('/commissions', token)).body.data.length === 1);
    expect((await http.get('/commissions', token)).body.data[0]).toMatchObject({
      orderId: order.id,
      amount: '200',
    });
  });

  it('readiness includes Redis: up when it answers, failed when it does not', async () => {
    const up = await boot();
    const ok = await request(up.app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(ok.body.data.checks).toMatchObject({ redis: 'up', database: 'up' });
    const down = await boot({ REDIS_URL: 'redis://127.0.0.1:1' });
    const bad = await request(down.app.getHttpServer()).get('/api/v1/health/ready').expect(503);
    expect(bad.body.details.failed).toEqual(['redis']);
  }, 30_000);
});

describe('Queues (inline mode, no Redis)', () => {
  it('runs the processor at once, in the workspace, and dead-letters after the attempts', async () => {
    const t = await createTestApp();
    try {
      const queues = t.app.get(QueueService);
      const cls = t.app.get(ClsService);
      const seen: unknown[] = [];
      let failures = 0;
      t.app.get(QueueRegistry).register({
        queue: 'email.send',
        attempts: 2,
        handler: async (payload) => {
          seen.push([cls.get('workspaceId'), payload['to']]);
          if (payload['to'] === 'bad') {
            failures += 1;
            throw new Error('nope');
          }
        },
      });
      await queues.add('email.send', 'send', { workspaceId: 'ws-1', to: 'ok' });
      expect(seen).toEqual([['ws-1', 'ok']]); // done before add returned
      await queues.add('email.send', 'send', { workspaceId: 'ws-1', to: 'bad' });
      expect(failures).toBe(2);
      expect((await queues.deadLetters())[0]).toMatchObject({
        queue: 'email.send',
        error: 'nope',
        attempts: 2,
      });
      await queues.idle('email.send');
    } finally {
      await t.close();
    }
  });
});
