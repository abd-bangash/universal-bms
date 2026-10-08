import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://bms:bms@localhost:5432/postgres';

export interface TestDatabase {
  url: string;
  prisma: PrismaClient;
  drop(): Promise<void>;
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * Creates a fresh database, applies every migration with `prisma migrate deploy`, and returns a
 * client for it. One database per test file keeps integration tests independent and lets each
 * migration create its own extensions.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `bms_t_${randomBytes(6).toString('hex')}`;
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  await admin.$disconnect();

  const url = withDatabase(ADMIN_URL, name);
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return {
    url,
    prisma,
    async drop() {
      await prisma.$disconnect();
      const cleaner = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
      await cleaner.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await cleaner.$disconnect();
    },
  };
}
