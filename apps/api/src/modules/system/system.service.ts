import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReadinessRegistry } from '../health/readiness';
import { QueueService } from '../queue/queue.service';
import { BackupStatusService, type BackupRecord } from '../platform/backup-status.service';

export interface SystemStatusDto {
  checkedAt: string;
  /** Database, queue store and file storage, as the readiness probe sees them. */
  services: Array<{ name: string; up: boolean }>;
  integrations: Array<{
    provider: string;
    type: string;
    status: string;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
  }>;
  queues: Array<{ name: string; waiting: number; active: number; delayed: number; failed: number }>;
  deadLetters: number;
  lastBackup: BackupRecord | null;
}

/** Everything the Owner needs to see on one page to know whether the system is healthy (Requirement 51.6). */
@Injectable()
export class SystemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: ReadinessRegistry,
    private readonly queues: QueueService,
    private readonly backups: BackupStatusService,
  ) {}

  async status(): Promise<SystemStatusDto> {
    const [services, rows, stats, lastBackup] = await Promise.all([
      Promise.all(
        this.readiness.all().map(async (c) => {
          try {
            await c.check();
            return { name: c.name, up: true };
          } catch {
            return { name: c.name, up: false };
          }
        }),
      ),
      this.prisma.scoped.integrationConnection.findMany({ orderBy: { provider: 'asc' } }),
      this.queues.stats().catch(() => null),
      this.backups.last(),
    ]);
    const all = Object.entries(stats ?? {}).map(([name, s]) => ({ name, ...s }));
    return {
      checkedAt: new Date().toISOString(),
      services,
      integrations: rows.map((r) => ({
        provider: r.provider,
        type: r.type,
        status: r.status,
        lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
        lastErrorAt: r.lastErrorAt?.toISOString() ?? null,
        lastError: r.lastError,
      })),
      queues: all.filter((q) => q.name !== 'dead-letter'),
      deadLetters: all.find((q) => q.name === 'dead-letter')?.waiting ?? 0,
      lastBackup,
    };
  }
}
