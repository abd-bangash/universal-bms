import { Prisma } from '@prisma/client';
import type { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../context/request-context';
import { TENANT_MODELS } from './tenant-models';

export class MissingWorkspaceContextError extends Error {
  constructor(model: string, operation: string) {
    super(`No workspace in context for ${model}.${operation}`);
  }
}

export class UnsupportedTenantOperationError extends Error {
  constructor(model: string, operation: string) {
    super(`Operation ${operation} is not allowed on tenant model ${model}`);
  }
}

/** Operations that filter with `where`: the workspace is ANDed into the filter. */
const READ_WRITE_WHERE = [
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
];

/** Operations that write `data`: the workspace is forced onto every row. */
const CREATE_DATA = ['create', 'createMany', 'createManyAndReturn'];

export interface OperationParams {
  model: string;
  operation: string;
  args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Prisma Client extension that injects the workspace of the current request into every
 * operation on a tenant-scoped model (design.md D2). It fails closed: with no workspace in
 * context, or for an operation it does not know, it throws instead of running unscoped.
 */
/** Applies the workspace of the current context to one operation; the extension delegates here. */
export async function runScoped(
  cls: ClsService<RequestContext>,
  { model, operation, args, query }: OperationParams,
): Promise<unknown> {
  if (!TENANT_MODELS.has(model)) return query(args);
  const workspaceId = cls.get('workspaceId');
  if (!workspaceId) throw new MissingWorkspaceContextError(model, operation);
  return query(scopeArgs(model, operation, args, workspaceId));
}

export const tenantExtensionDefinition = (cls: ClsService<RequestContext>) => ({
  name: 'tenant-scope',
  query: {
    $allModels: {
      async $allOperations(params: unknown): Promise<never> {
        // Prisma types these parameters per model; the logic is the same for all of them.
        return (await runScoped(cls, params as OperationParams)) as never;
      },
    },
  },
});

export const tenantExtension = (cls: ClsService<RequestContext>) =>
  Prisma.defineExtension(tenantExtensionDefinition(cls));

/** Pure transformation of operation arguments; exported for exhaustive unit testing. */
export function scopeArgs(
  model: string,
  operation: string,
  args: Record<string, unknown>,
  workspaceId: string,
): Record<string, unknown> {
  const scoped: Record<string, unknown> = { ...args };
  if (READ_WRITE_WHERE.includes(operation)) {
    scoped.where = { ...((args.where as object | undefined) ?? {}), workspaceId };
  } else if (CREATE_DATA.includes(operation)) {
    scoped.data = Array.isArray(args.data)
      ? args.data.map((row: object) => ({ ...row, workspaceId }))
      : { ...(args.data as object), workspaceId };
  } else if (operation === 'upsert') {
    scoped.where = { ...(args.where as object), workspaceId };
    scoped.create = { ...(args.create as object), workspaceId };
  } else {
    throw new UnsupportedTenantOperationError(model, operation);
  }
  return scoped;
}
