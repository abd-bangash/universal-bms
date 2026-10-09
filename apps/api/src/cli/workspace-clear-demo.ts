import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { StorageAdapter } from '@bms/types';
import { AppModule } from '../app.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { TENANT_MODELS } from '../common/prisma/tenant-models';
import { STORAGE } from '../modules/files/storage/storage.token';
import { clearDemoRecords, CONFIGURATION_MODELS } from '../seed/demo-reset';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * For go-live: removes the demo business records from a workspace (customers, leads, products, orders,
 * payments, stock, conversations ...) and keeps everything configured (staff, roles, settings,
 * workflows, fields, accounts, templates ...). The workspace stops being a demo. Without --yes it
 * only shows what would go. Usage:
 *   node dist/cli/workspace-clear-demo.js --workspace <slug or id> [--yes]
 */
async function main(): Promise<void> {
  const which = arg('workspace');
  if (!which) throw new Error('Say which workspace: --workspace <slug or id>');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const workspace = await prisma.unscoped.workspace.findFirst({
      where: { OR: [{ id: which }, { slug: which }] },
    });
    if (!workspace) throw new Error(`No workspace "${which}".`);
    if (!workspace.isDemo) {
      throw new Error(`"${workspace.name}" is not a demo workspace, so there is nothing to clear.`);
    }
    if (!process.argv.includes('--yes')) {
      const counts = prisma.unscoped as unknown as Record<
        string,
        { count(a: unknown): Promise<number> }
      >;
      console.log(`"${workspace.name}" would lose these records (run again with --yes to do it):`);
      for (const model of new Set(TENANT_MODELS)) {
        if (CONFIGURATION_MODELS.has(model)) continue;
        const delegate = counts[model.charAt(0).toLowerCase() + model.slice(1)];
        const n = await delegate?.count({ where: { workspaceId: workspace.id } }).catch(() => 0);
        if (n) console.log(`  ${model}: ${n}`);
      }
      process.exit(2);
    }
    const report = await clearDemoRecords(prisma, workspace.id, app.get<StorageAdapter>(STORAGE));
    for (const [model, n] of Object.entries(report.deleted))
      console.log(`  ${model}: ${n} removed`);
    console.log(`\n"${workspace.name}" now holds its configuration only and is no longer a demo.`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
