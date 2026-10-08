import { Body, Controller, Get, Module, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsInt, IsString } from 'class-validator';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { CommonModule } from '../src/common/common.module';
import { AuthThrottle } from '../src/common/throttle/throttle';
import { Page } from '../src/common/pagination/pagination';
import { HealthModule } from '../src/modules/health/health.module';
import { ReadinessRegistry, type ReadinessCheck } from '../src/modules/health/readiness';

class CreateThingDto {
  @IsString() name!: string;
  @IsInt() qty!: number;
}

@Controller('things')
class ThingsController {
  @Get() list(): Page<{ id: string }> {
    return new Page([{ id: 'a' }], 'next-cursor', 1);
  }
  @Get('boom') boom(): never {
    throw new Error('secret connection string postgres://u:p@host/db');
  }
  @Post() create(@Body() dto: CreateThingDto): CreateThingDto {
    return dto;
  }
  @Get('when') when(): { at: Date } {
    return { at: new Date('2026-01-02T03:04:05.000Z') };
  }
  @Post('login') @AuthThrottle() login(): { ok: true } {
    return { ok: true };
  }
}

@Module({ imports: [CommonModule, HealthModule], controllers: [ThingsController] })
class TestAppModule {}

async function createApp(
  appEnv: 'development' | 'production' = 'development',
  checks: ReadinessCheck[] = [],
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
  const app = moduleRef.createNestApplication();
  for (const check of checks) moduleRef.get(ReadinessRegistry).register(check);
  configureApp(app, { APP_ENV: appEnv, WEB_ORIGIN: 'http://localhost:3000' });
  await app.init();
  return app;
}

describe('API common layer', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it('serves under /api/v1 with a success envelope and pagination meta', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/things').expect(200);
    expect(res.body).toEqual({
      data: [{ id: 'a' }],
      meta: { nextCursor: 'next-cursor', total: 1 },
    });
  });

  it('wraps plain results as { data }', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
  });

  it('does not serve outside the prefix', async () => {
    await request(app.getHttpServer()).get('/things').expect(404);
  });

  it('returns the error envelope for unknown routes with a request id header', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nothing').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('keeps a safe caller-supplied request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/nothing')
      .set('X-Request-Id', 'abc-12345678')
      .expect(404);
    expect(res.body.requestId).toBe('abc-12345678');
  });

  it('never leaks internals from unhandled errors', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/things/boom').expect(500);
    expect(res.body).toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('stack');
    expect(text).not.toContain('at ');
  });

  it('reports field-level validation errors and rejects unknown properties', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/things')
      .send({ name: 5, qty: 'x', extra: true })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(res.body.details)).toEqual(expect.arrayContaining(['name', 'qty', 'extra']));
  });

  it('accepts values that look like injection (inputs are validated by type, not pattern)', async () => {
    const name = "O'Brien'; DROP TABLE x; --";
    const res = await request(app.getHttpServer())
      .post('/api/v1/things')
      .send({ name, qty: 1 })
      .expect(201);
    expect(res.body.data.name).toBe(name);
  });

  it('returns dates as ISO 8601 UTC', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/things/when').expect(200);
    expect(res.body.data.at).toBe('2026-01-02T03:04:05.000Z');
  });

  it('sends security headers and restricts CORS to WEB_ORIGIN', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Origin', 'http://localhost:3000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const other = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Origin', 'http://evil.example');
    expect(other.headers['access-control-allow-origin']).not.toBe('http://evil.example');
  });

  it('rate limits authentication endpoints at 10 per minute with Retry-After', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer()).post('/api/v1/things/login').expect(201);
    }
    const res = await request(app.getHttpServer()).post('/api/v1/things/login').expect(429);
    expect(res.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('serves OpenAPI docs outside production', async () => {
    await request(app.getHttpServer()).get('/api/v1/docs').expect(200);
    await request(app.getHttpServer()).get('/api/v1/docs-json').expect(200);
  });
});

describe('API in production', () => {
  it('does not serve OpenAPI docs', async () => {
    const app = await createApp('production');
    await request(app.getHttpServer()).get('/api/v1/docs').expect(404);
    await app.close();
  });
});

describe('Readiness', () => {
  it('is ready when every check passes', async () => {
    const app = await createApp('development', [
      { name: 'database', check: async () => undefined },
    ]);
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(res.body.data).toEqual({ status: 'ok', checks: { database: 'up' } });
    await app.close();
  });

  it('answers 503 naming the failed dependency, without its error text', async () => {
    const app = await createApp('development', [
      {
        name: 'redis',
        check: async () => {
          throw new Error('connect ECONNREFUSED 10.0.0.1:6379');
        },
      },
    ]);
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
    expect(res.body).toMatchObject({
      code: 'EXTERNAL_SERVICE_FAILED',
      details: { failed: ['redis'] },
    });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
    await app.close();
  });
});
