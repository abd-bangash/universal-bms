import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { ENV, type Env } from '../config/env';
import { PasswordService } from '../modules/auth/password.service';
import { IndustryProfileService } from '../modules/tenants/industry-profile.service';
import { TenantsService } from '../modules/tenants/tenants.service';
import {
  assertSeedAllowed,
  runDemoSeed,
  SeedRefusedError,
  DEMO_WORKSPACE,
} from '../seed/demo-seed';
import { DEMO_STEPS } from '../seed/steps';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * Creates (or tops up) the demo workspace on the furniture profile, with one staff member per role.
 * Safe to run repeatedly. Usage:
 *   node dist/cli/seed-demo.js [--password <pw>] [--reset-passwords]
 * Without --password a random one is generated and printed (only when users are created).
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    assertSeedAllowed(app.get<Env>(ENV));
    await app.get(IndustryProfileService).syncBuiltIn();
    const generated = arg('password') === undefined;
    const password = arg('password') ?? randomBytes(9).toString('base64url');
    const report = await runDemoSeed(
      {
        prisma: app.get(PrismaService),
        tenants: app.get(TenantsService),
        passwords: app.get(PasswordService),
        get: (token) => app.get(token),
      },
      DEMO_STEPS,
      {
        password,
        resetPasswords: process.argv.includes('--reset-passwords'),
        log: (m) => console.log(m),
      },
    );
    const createdAnything =
      report.steps.some((s) => s.created > 0) || process.argv.includes('--reset-passwords');
    console.log(
      `\nDemo workspace "${DEMO_WORKSPACE.name}" is ready (${report.workspaceId}). Sign in as ${DEMO_WORKSPACE.ownerEmail}, manager@demo.test, salesperson@demo.test ...`,
    );
    if (createdAnything)
      console.log(
        generated
          ? `Password for the demo users created now: ${password}`
          : 'The demo users created now use the password you gave.',
      );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(err instanceof SeedRefusedError ? 3 : 1);
});
