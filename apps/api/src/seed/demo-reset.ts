import { Prisma } from '@prisma/client';
import type { StorageAdapter } from '@bms/types';
import type { PrismaService } from '../common/prisma/prisma.service';
import { TENANT_MODELS } from '../common/prisma/tenant-models';

/**
 * Removing the demo data (Requirements 50.4 and 50.6). Two operations on a workspace that is marked
 * as a demo:
 *
 *  - `clearDemoRecords` removes its business records (customers, leads, products, orders, payments,
 *    stock, conversations ...) and keeps its configuration (people, roles, settings, workflows, fields,
 *    units, accounts, payment methods, categories, templates, approved answers ...), then marks the
 *    workspace as no longer a demo. It is for go-live.
 *  - `wipeWorkspace` removes everything about the workspace, the demo staff included, so the seed can
 *    build it again from nothing. It is for `demo:reset`.
 *
 * Three tables refuse changes by design (the audit trail, the stock ledger, issued invoices). These
 * operations are the only code that lifts that for the length of one transaction, and only for a
 * workspace marked as a demo; the protection is back before anything else can touch the tables.
 */

/** Tables whose triggers refuse UPDATE and DELETE, with the trigger that does it. */
const GUARDED: ReadonlyArray<{ table: string; trigger: string }> = [
  { table: 'audit_events', trigger: 'audit_events_append_only' },
  { table: 'stock_movements', trigger: 'stock_movements_append_only' },
  { table: 'invoices', trigger: 'invoices_immutable' },
];

/** What go-live keeps. Every other tenant model is a business record and goes. A new model must be classified here (a test checks). */
export const CONFIGURATION_MODELS: ReadonlySet<string> = new Set([
  'Workspace',
  'UserWorkspace',
  'Role',
  'UserWorkspaceRole',
  'Invitation',
  'AuditEvent', // the history of what was done stays, including that the demo data was cleared
  'FieldDefinition',
  'Workflow',
  'WorkflowState',
  'WorkflowTransition',
  'Unit',
  'TaxClass',
  'InventoryLocation',
  'Category',
  'LostReason',
  'FinancialAccount',
  'PaymentMethod',
  'ExpenseCategory',
  'AdjustmentReason',
  'CommissionRule',
  'IntegrationConnection',
  'MessageTemplate',
  'KnowledgeItem',
  'QuestionFlow',
  'IndustryProfile',
]);

interface ModelInfo {
  name: string;
  table: string;
  /** The tables this one has foreign keys to: rows here must be deleted before rows there. */
  dependsOn: string[];
}

function modelInfo(): Map<string, ModelInfo> {
  const models = Prisma.dmmf.datamodel.models;
  const byName = new Map(models.map((m) => [m.name, m]));
  const info = new Map<string, ModelInfo>();
  for (const name of new Set(TENANT_MODELS)) {
    const model = byName.get(name);
    if (!model) continue;
    const dependsOn = model.fields
      .filter(
        (f) => f.kind === 'object' && (f.relationFromFields?.length ?? 0) > 0 && f.type !== name,
      )
      .map((f) => f.type);
    info.set(name, { name, table: model.dbName ?? model.name, dependsOn });
  }
  return info;
}

/** Order in which to delete: a table before the tables it points to. Cycles (none expected) are broken arbitrarily. */
export function deletionOrder(names: Iterable<string>): string[] {
  const info = modelInfo();
  const chosen = new Set([...names].filter((n) => info.has(n)));
  const order: string[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  // a model must come before the ones it depends on, so visit the models that depend on it first
  const dependents = new Map<string, string[]>();
  for (const n of chosen) {
    for (const d of info.get(n)!.dependsOn) {
      if (!chosen.has(d)) continue;
      dependents.set(d, [...(dependents.get(d) ?? []), n]);
    }
  }
  const visit = (n: string) => {
    if (done.has(n) || visiting.has(n)) return;
    visiting.add(n);
    for (const dependent of dependents.get(n) ?? []) visit(dependent);
    visiting.delete(n);
    done.add(n);
    order.push(n);
  };
  for (const n of [...chosen].sort()) visit(n);
  return order;
}

export interface PurgeReport {
  deleted: Record<string, number>;
  /** Storage keys of the files that were removed, for the caller to delete from storage. */
  fileKeys: string[];
}

type Tx = Prisma.TransactionClient;

async function removeFrom(
  tx: Tx,
  info: ModelInfo,
  workspaceId: string,
  extra: Prisma.Sql,
): Promise<number> {
  const column = info.name === 'Workspace' ? 'id' : 'workspace_id';
  return tx.$executeRaw`DELETE FROM ${Prisma.raw(`"${info.table}"`)} WHERE ${Prisma.raw(`"${column}"`)} = ${workspaceId} ${extra}`;
}

async function inGuardedTransaction<T>(
  prisma: PrismaService,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.unscoped.$transaction(
    async (tx) => {
      for (const g of GUARDED) {
        await tx.$executeRawUnsafe(`ALTER TABLE "${g.table}" DISABLE TRIGGER "${g.trigger}"`);
      }
      try {
        return await work(tx);
      } finally {
        // inside the same transaction, so a failure rolls back both the work and this
        for (const g of GUARDED) {
          await tx.$executeRawUnsafe(`ALTER TABLE "${g.table}" ENABLE TRIGGER "${g.trigger}"`);
        }
      }
    },
    { timeout: 300_000, maxWait: 60_000 },
  );
}

async function demoWorkspace(prisma: PrismaService, workspaceId: string) {
  const workspace = await prisma.unscoped.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw new Error('That workspace does not exist.');
  if (!workspace.isDemo) {
    throw new Error(
      `"${workspace.name}" is not marked as a demo workspace, so its data is not removed by this command.`,
    );
  }
  return workspace;
}

/** Removes the business records of a demo workspace, keeps its configuration, and marks it as a real one. */
export async function clearDemoRecords(
  prisma: PrismaService,
  workspaceId: string,
  storage?: StorageAdapter,
): Promise<PurgeReport> {
  const workspace = await demoWorkspace(prisma, workspaceId);
  const info = modelInfo();
  const records = deletionOrder([...info.keys()].filter((m) => !CONFIGURATION_MODELS.has(m)));
  const logo = ((workspace.config as { branding?: { logoFileId?: string } } | null)?.branding
    ?.logoFileId ?? '') as string;
  const report: PurgeReport = { deleted: {}, fileKeys: [] };

  await inGuardedTransaction(prisma, async (tx) => {
    for (const name of records) {
      const model = info.get(name)!;
      let extra = Prisma.empty;
      // the walk-in customer, the logo and the placeholder channel are configuration the workspace keeps working with
      if (name === 'Customer') extra = Prisma.sql`AND NOT "is_walk_in"`;
      if (name === 'FileAsset') {
        const files = await tx.fileAsset.findMany({
          where: { workspaceId, ...(logo ? { id: { not: logo } } : {}) },
          select: { storageKey: true, thumbnailKey: true },
        });
        report.fileKeys.push(
          ...files.flatMap((f) =>
            [f.storageKey, f.thumbnailKey].filter((k): k is string => Boolean(k)),
          ),
        );
        extra = logo ? Prisma.sql`AND "id" <> ${logo}` : Prisma.empty;
      }
      const count = await removeFrom(tx, model, workspaceId, extra);
      if (count > 0) report.deleted[name] = count;
    }
    // the demo channel exists only to hold the demo conversations
    const channel = await tx.integrationConnection.deleteMany({
      where: {
        workspaceId,
        status: 'DISCONNECTED',
        externalAccountId: null,
        displayName: { startsWith: 'Demo WhatsApp line' },
      },
    });
    if (channel.count > 0) report.deleted['IntegrationConnection'] = channel.count;
    await tx.workspace.update({ where: { id: workspaceId }, data: { isDemo: false } });
    await tx.auditEvent.create({
      data: {
        workspaceId,
        actorType: 'SYSTEM',
        action: 'workspace.clear_demo',
        entityType: 'Workspace',
        entityId: workspaceId,
        metadata: { deleted: report.deleted } as Prisma.InputJsonValue,
      },
    });
  });
  await removeFiles(storage, report.fileKeys);
  return report;
}

/** Removes everything about a demo workspace, the people in it included. */
export async function wipeWorkspace(
  prisma: PrismaService,
  workspaceId: string,
  storage?: StorageAdapter,
): Promise<PurgeReport> {
  await demoWorkspace(prisma, workspaceId);
  const info = modelInfo();
  const all = deletionOrder(
    [...info.keys()].filter((m) => m !== 'Workspace' && m !== 'IndustryProfile'),
  );
  const report: PurgeReport = { deleted: {}, fileKeys: [] };

  await inGuardedTransaction(prisma, async (tx) => {
    const members = await tx.userWorkspace.findMany({
      where: { workspaceId },
      select: { userId: true },
    });
    report.fileKeys.push(
      ...(
        await tx.fileAsset.findMany({
          where: { workspaceId },
          select: { storageKey: true, thumbnailKey: true },
        })
      ).flatMap((f) => [f.storageKey, f.thumbnailKey].filter((k): k is string => Boolean(k))),
    );
    // webhook events are global (the workspace is optional on them)
    await tx.webhookEvent.deleteMany({ where: { workspaceId } });
    for (const name of all) {
      const count = await removeFrom(tx, info.get(name)!, workspaceId, Prisma.empty);
      if (count > 0) report.deleted[name] = count;
    }
    await tx.workspace.delete({ where: { id: workspaceId } });
    // people who belonged to no other workspace go with it
    for (const { userId } of members) {
      const elsewhere = await tx.userWorkspace.count({ where: { userId } });
      if (elsewhere > 0) continue;
      await tx.userSession.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
      report.deleted['User'] = (report.deleted['User'] ?? 0) + 1;
    }
  });
  await removeFiles(storage, report.fileKeys);
  return report;
}

async function removeFiles(storage: StorageAdapter | undefined, keys: string[]): Promise<void> {
  if (!storage) return;
  for (const key of keys) await storage.delete(key).catch(() => undefined); // an object that is already gone is not a problem
}
