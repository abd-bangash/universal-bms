import { AsyncLocalStorage } from 'node:async_hooks';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../src/common/context/request-context';
import { createScopedClient } from '../src/common/prisma/prisma.service';
import { TENANT_MODELS } from '../src/common/prisma/tenant-models';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import { ensureWorkspace, tenantFactories } from './helpers/tenant-factories';

type Delegate = Record<string, (args?: unknown) => Promise<unknown>>;

/**
 * Property 1 — tenant isolation. For every tenant-scoped model in schema.prisma: a row created in
 * workspace A is never returned by, and never changed or deleted by, any operation in workspace B.
 * The test enumerates the models from the generated list, so it covers each model as soon as its
 * schema task adds it (and fails until that task registers a factory).
 */
describe('Property 1 — tenant isolation', () => {
  let db: TestDatabase;
  const cls = new ClsService<RequestContext>(new AsyncLocalStorage());

  beforeAll(async () => {
    db = await createTestDatabase();
  }, 60_000);
  afterAll(() => db.drop());

  const inWorkspace = <T>(workspaceId: string, fn: () => Promise<T>): Promise<T> =>
    cls.run(async () => {
      cls.set('workspaceId', workspaceId);
      return fn();
    });

  it('has a factory for every tenant model', () => {
    const missing = [...TENANT_MODELS].filter((m) => !(m in tenantFactories));
    expect(missing).toEqual([]);
  });

  for (const model of TENANT_MODELS) {
    it(`${model} is invisible and immutable from another workspace`, async () => {
      const scoped = createScopedClient(db.prisma, cls) as unknown as Record<string, Delegate>;
      const delegate = scoped[model.charAt(0).toLowerCase() + model.slice(1)];
      const factory = tenantFactories[model];
      if (!delegate || !factory) throw new Error(`No delegate or factory for ${model}`);
      const call = (name: string, args?: unknown) => {
        const fn = delegate[name];
        if (!fn) throw new Error(`${model} has no ${name}`);
        return fn.call(delegate, args);
      };

      const wsA = `ws_a_${model}`;
      const wsB = `ws_b_${model}`;
      const { where } = await factory(db.prisma, wsA);
      await ensureWorkspace(db.prisma, wsB);

      expect(await inWorkspace(wsB, () => call('findMany'))).toEqual([]);
      expect(await inWorkspace(wsB, () => call('findFirst', { where }))).toBeNull();
      expect(await inWorkspace(wsB, () => call('count'))).toBe(0);
      expect(await inWorkspace(wsB, () => call('updateMany', { where, data: {} }))).toEqual({
        count: 0,
      });
      expect(await inWorkspace(wsB, () => call('deleteMany', { where }))).toEqual({
        count: 0,
      });

      const visibleToOwner = await inWorkspace(wsA, () => call('findMany'));
      expect(visibleToOwner).toHaveLength(1);
    });
  }
});
