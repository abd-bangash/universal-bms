import { AsyncLocalStorage } from 'node:async_hooks';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../context/request-context';
import {
  MissingWorkspaceContextError,
  UnsupportedTenantOperationError,
  runScoped,
  scopeArgs,
  tenantExtension,
  tenantExtensionDefinition,
} from '../tenant.extension';

jest.mock('../tenant-models', () => ({
  TENANT_MODELS: new Set(['Thing']),
  GLOBAL_MODELS: new Set(['Other']),
}));

const WS = 'ws_1';

describe('scopeArgs', () => {
  it.each([
    'findFirst',
    'findFirstOrThrow',
    'findMany',
    'findUnique',
    'findUniqueOrThrow',
    'update',
    'updateMany',
    'updateManyAndReturn',
    'delete',
    'deleteMany',
    'count',
    'aggregate',
    'groupBy',
  ])('adds the workspace to the where of %s', (operation) => {
    expect(scopeArgs('Thing', operation, { where: { id: 'a' } }, WS).where).toEqual({
      id: 'a',
      workspaceId: WS,
    });
    expect(scopeArgs('Thing', operation, {}, WS).where).toEqual({ workspaceId: WS });
  });

  it('overrides a workspace supplied by the caller', () => {
    const args = scopeArgs('Thing', 'findMany', { where: { workspaceId: 'someone_else' } }, WS);
    expect(args.where).toEqual({ workspaceId: WS });
  });

  it('forces the workspace onto create', () => {
    expect(
      scopeArgs('Thing', 'create', { data: { name: 'x', workspaceId: 'evil' } }, WS).data,
    ).toEqual({
      name: 'x',
      workspaceId: WS,
    });
  });

  it.each(['createMany', 'createManyAndReturn'])(
    'forces the workspace onto every row of %s',
    (op) => {
      const single = scopeArgs('Thing', op, { data: { name: 'a' } }, WS).data;
      expect(single).toEqual({ name: 'a', workspaceId: WS });
      const many = scopeArgs(
        'Thing',
        op,
        { data: [{ name: 'a' }, { name: 'b', workspaceId: 'evil' }] },
        WS,
      );
      expect(many.data).toEqual([
        { name: 'a', workspaceId: WS },
        { name: 'b', workspaceId: WS },
      ]);
    },
  );

  it('scopes both the lookup and the create branch of upsert', () => {
    const args = scopeArgs(
      'Thing',
      'upsert',
      { where: { id: 'a' }, create: { name: 'n' }, update: { name: 'm' } },
      WS,
    );
    expect(args.where).toEqual({ id: 'a', workspaceId: WS });
    expect(args.create).toEqual({ name: 'n', workspaceId: WS });
    expect(args.update).toEqual({ name: 'm' });
  });

  it('does not mutate the caller arguments', () => {
    const where = { id: 'a' };
    scopeArgs('Thing', 'findMany', { where }, WS);
    expect(where).toEqual({ id: 'a' });
  });

  it('fails closed for operations it does not know', () => {
    expect(() => scopeArgs('Thing', 'someFutureOperation', {}, WS)).toThrow(
      UnsupportedTenantOperationError,
    );
  });
});

describe('runScoped', () => {
  const cls = new ClsService<RequestContext>(new AsyncLocalStorage());
  const query = jest.fn(async (args: Record<string, unknown>) => args);

  beforeEach(() => query.mockClear());

  it('passes non-tenant models through untouched, even without a workspace', async () => {
    const args = { where: { id: 'a' } };
    await expect(
      runScoped(cls, { model: 'Other', operation: 'findMany', args, query }),
    ).resolves.toBe(args);
  });

  it('refuses tenant models when no workspace is in context', async () => {
    await expect(
      runScoped(cls, { model: 'Thing', operation: 'findMany', args: {}, query }),
    ).rejects.toThrow(MissingWorkspaceContextError);
    expect(query).not.toHaveBeenCalled();
  });

  it('scopes tenant models using the workspace of the current context', async () => {
    await cls.run(async () => {
      cls.set('workspaceId', WS);
      await runScoped(cls, { model: 'Thing', operation: 'findMany', args: {}, query });
    });
    expect(query).toHaveBeenCalledWith({ where: { workspaceId: WS } });
  });

  it('keeps two concurrent contexts apart', async () => {
    const seen: string[] = [];
    const record = async (args: Record<string, unknown>) => {
      seen.push((args.where as { workspaceId: string }).workspaceId);
      return args;
    };
    await Promise.all(
      ['ws_a', 'ws_b', 'ws_c'].map((id) =>
        cls.run(async () => {
          cls.set('workspaceId', id);
          await new Promise((r) => setTimeout(r, Math.random() * 5));
          await runScoped(cls, { model: 'Thing', operation: 'findMany', args: {}, query: record });
        }),
      ),
    );
    expect(seen.sort()).toEqual(['ws_a', 'ws_b', 'ws_c']);
  });
});

describe('tenantExtension', () => {
  it('routes every model operation through the workspace scoping', async () => {
    const cls = new ClsService<RequestContext>(new AsyncLocalStorage());
    const ext = tenantExtensionDefinition(cls);
    expect(typeof tenantExtension(cls)).toBe('function');
    const query = jest.fn(async (args: Record<string, unknown>) => args);
    const params = { model: 'Thing', operation: 'findMany', args: {}, query };

    await expect(ext.query.$allModels.$allOperations(params)).rejects.toThrow(
      MissingWorkspaceContextError,
    );
    await cls.run(async () => {
      cls.set('workspaceId', WS);
      await expect(ext.query.$allModels.$allOperations(params)).resolves.toEqual({
        where: { workspaceId: WS },
      });
    });
  });
});
