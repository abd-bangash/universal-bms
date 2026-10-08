import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../src/common/context/request-context';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ReadinessRegistry } from '../src/modules/health/readiness';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';

describe('Prisma base (real PostgreSQL)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  }, 60_000);
  afterAll(() => db.drop());

  it('migration 0001 creates pg_trgm and citext', async () => {
    const rows = await db.prisma.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm', 'citext') ORDER BY extname`;
    expect(rows.map((r) => r.extname)).toEqual(['citext', 'pg_trgm']);
  });

  it('PrismaService registers a database readiness check that passes and fails correctly', async () => {
    const make = (url: string) => {
      const registry = new ReadinessRegistry();
      const service = new PrismaService(
        new ClsService<RequestContext>(new AsyncLocalStorage()),
        registry,
      );
      // The check uses whichever client is current when it runs.
      Object.assign(service, {
        unscoped: new PrismaClient({ datasources: { db: { url } } }),
      });
      service.onModuleInit();
      return { service, check: registry.all()[0] };
    };

    const good = make(db.url);
    expect(good.check?.name).toBe('database');
    await expect(good.check?.check()).resolves.toBeUndefined();
    await good.service.onModuleDestroy();

    const bad = make('postgresql://bms:bms@localhost:1/none');
    await expect(bad.check?.check()).rejects.toBeDefined();
    await bad.service.onModuleDestroy();
  });
});
