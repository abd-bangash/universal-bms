import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BackupStatusService } from '../modules/platform/backup-status.service';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * Called by scripts/backup.sh after a backup has been written and checked, so the Owner's system
 * status page can show when the last good one was taken. Usage:
 *   node dist/cli/backup-record.js [--note "s3://bucket/file, 12 MB"] [--at 2026-01-31T02:00:00Z]
 */
async function main(): Promise<void> {
  const at = arg('at') ? new Date(arg('at') as string) : new Date();
  if (Number.isNaN(at.getTime())) throw new Error('--at must be an ISO 8601 date and time');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const saved = await app.get(BackupStatusService).record(at, arg('note') ?? null);
    console.log(`Recorded a successful backup at ${saved.at}.`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
