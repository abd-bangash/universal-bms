import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { StorageAdapter } from '@bms/types';
import { AppModule } from '../app.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { ENV, type Env } from '../config/env';
import { STORAGE } from '../modules/files/storage/storage.token';
import { PasswordService } from '../modules/auth/password.service';
import { IndustryProfileService } from '../modules/tenants/industry-profile.service';
import { TenantsService } from '../modules/tenants/tenants.service';
import {
  assertSeedAllowed,
  DEMO_WORKSPACE,
  runDemoSeed,
  SeedRefusedError,
} from '../seed/demo-seed';
import { wipeWorkspace } from '../seed/demo-reset';
import { DEMO_STEPS } from '../seed/steps';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * Puts the demo workspace back to its seeded state: everything in it is removed (its staff included)
 * and the demo dataset is built again. Only a workspace marked as a demo is touched. Usage:
 *   node dist/cli/demo-reset.js [--password <pw>]
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    assertSeedAllowed(app.get<Env>(ENV));
    const prisma = app.get(PrismaService);
    const existing = await prisma.unscoped.workspace.findUnique({
      where: { slug: DEMO_WORKSPACE.slug },
    });
    if (existing) {
      const report = await wipeWorkspace(prisma, existing.id, app.get<StorageAdapter>(STORAGE));
      const rows = Object.values(report.deleted).reduce((a, b) => a + b, 0);
      console.log(`Removed the demo workspace "${existing.name}" (${rows} rows).`);
    } else {
      console.log('There was no demo workspace; creating one.');
    }
    await app.get(IndustryProfileService).syncBuiltIn();
    const generated = arg('password') === undefined;
    const password = arg('password') ?? randomBytes(9).toString('base64url');
    const seeded = await runDemoSeed(
      {
        prisma,
        tenants: app.get(TenantsService),
        passwords: app.get(PasswordService),
        get: (token) => app.get(token),
      },
      DEMO_STEPS,
      { password, resetPasswords: true, log: (m) => console.log(m) },
    );
    console.log(
      `\nDemo workspace "${DEMO_WORKSPACE.name}" is back to its seeded state (${seeded.workspaceId}).`,
    );
    console.log(
      generated
        ? `Password for the demo users: ${password}`
        : 'The demo users use the password you gave.',
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(err instanceof SeedRefusedError ? 3 : 1);
});
