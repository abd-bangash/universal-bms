import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

const KEY = 'backup.last_success';

export interface BackupRecord {
  /** When the backup finished, ISO 8601 (UTC). */
  at: string;
  /** What the operator wants remembered: where it went, its size, or "restore rehearsed". */
  note: string | null;
}

/**
 * The time of the last successful backup (Requirement 51.6). The backup script runs outside the
 * application, so it reports in through `pnpm backup:record`; the status page reads it from here.
 */
@Injectable()
export class BackupStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async last(): Promise<BackupRecord | null> {
    const row = await this.prisma.unscoped.platformSetting.findUnique({ where: { key: KEY } });
    const value = row?.value as Partial<BackupRecord> | null | undefined;
    return value?.at ? { at: value.at, note: value.note ?? null } : null;
  }

  async record(at: Date, note: string | null): Promise<BackupRecord> {
    const value: BackupRecord = { at: at.toISOString(), note };
    await this.prisma.unscoped.platformSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: { ...value } },
      update: { value: { ...value } },
    });
    return value;
  }
}
