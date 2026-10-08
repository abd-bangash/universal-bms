import type { PrismaClient } from '@prisma/client';

/**
 * Creates one row of a tenant model inside a given workspace, using the raw client.
 * Every schema task that adds a tenant model must register a factory here; the
 * tenant-isolation property test fails for a tenant model that has none.
 */
export type TenantFactory = (prisma: PrismaClient, workspaceId: string) => Promise<{ id: string }>;

export const tenantFactories: Record<string, TenantFactory> = {};
