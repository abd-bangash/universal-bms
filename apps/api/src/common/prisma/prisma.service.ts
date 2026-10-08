import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../context/request-context';
import { ReadinessRegistry } from '../../modules/health/readiness';
import { tenantExtension } from './tenant.extension';

export const createScopedClient = (client: PrismaClient, cls: ClsService<RequestContext>) =>
  client.$extends(tenantExtension(cls));
export type ScopedPrismaClient = ReturnType<typeof createScopedClient>;
/** The transaction client handed to `prisma.scoped.$transaction(async (tx) => ...)`. */
export type ScopedTransaction = Parameters<Parameters<ScopedPrismaClient['$transaction']>[0]>[0];

/**
 * `scoped` is the only client business modules use (every tenant model is filtered by the
 * workspace in context). `unscoped` is the raw client and is restricted by an ESLint rule to
 * auth, tenants, platform, webhook workspace resolution, seeds and tests.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly unscoped = new PrismaClient();
  readonly scoped: ScopedPrismaClient;

  constructor(
    cls: ClsService<RequestContext>,
    private readonly readiness: ReadinessRegistry,
  ) {
    this.scoped = createScopedClient(this.unscoped, cls);
  }

  onModuleInit(): void {
    this.readiness.register({
      name: 'database',
      check: async () => {
        await this.unscoped.$queryRaw`SELECT 1`;
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.unscoped.$disconnect();
  }
}
