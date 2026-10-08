import { Injectable } from '@nestjs/common';
import type { WorkspaceConfig } from '@bms/types';
import { workspaceConfigSchema, zodIssuesToDetails } from '@bms/validators';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { mergeConfig } from '../tenants/default-config';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Flattens nested objects to dotted paths; arrays and scalars are leaves. */
export function flatten(value: unknown, prefix = ''): Record<string, unknown> {
  if (!isObject(value)) return prefix ? { [prefix]: value } : {};
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isObject(inner) && Object.keys(inner).length > 0) Object.assign(out, flatten(inner, path));
    else out[path] = inner;
  }
  return out;
}

export interface SettingsSnapshot {
  config: WorkspaceConfig;
  configVersion: number;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<RequestContext>,
    private readonly audit: AuditService,
  ) {}

  /**
   * The workspace configuration, read once per request (the cache lives in the request context, so
   * a change made by PATCH /settings applies to the very next request, with no restart).
   */
  async snapshot(workspaceId: string = this.requireWorkspace()): Promise<SettingsSnapshot> {
    const cached = this.cls.get('settingsCache');
    if (cached?.workspaceId === workspaceId) {
      return { config: cached.config as WorkspaceConfig, configVersion: cached.configVersion };
    }
    const row = await this.prisma.scoped.workspace.findUnique({
      where: { id: workspaceId },
      select: { config: true, configVersion: true },
    });
    if (!row) throw new NotFoundAppException();
    // Stored configs are validated on write; parsing again fills any key added by a later release.
    const config = workspaceConfigSchema.parse(row.config) as unknown as WorkspaceConfig;
    if (this.cls.isActive()) {
      this.cls.set('settingsCache', { workspaceId, configVersion: row.configVersion, config });
    }
    return { config, configVersion: row.configVersion };
  }

  async industryProfileKey(): Promise<string | null> {
    const row = await this.prisma.scoped.workspace.findUnique({
      where: { id: this.requireWorkspace() },
      select: { industryProfile: true },
    });
    return row?.industryProfile ?? null;
  }

  /** One value by dotted path, e.g. `get('sales.requiredDepositPercent')`. */
  async get<T = unknown>(path: string, workspaceId?: string): Promise<T> {
    const { config } = await this.snapshot(workspaceId);
    return path
      .split('.')
      .reduce<unknown>((node, key) => (isObject(node) ? node[key] : undefined), config) as T;
  }

  async moduleEnabled(module: string, workspaceId?: string): Promise<boolean> {
    const { config } = await this.snapshot(workspaceId);
    return (config.modules as unknown as Record<string, boolean>)[module] === true;
  }

  /**
   * Applies a partial change: merges into the current config, validates the WHOLE result, bumps
   * configVersion and audits exactly the paths that changed (Requirements 5.2, 5.4).
   */
  async update(patch: unknown): Promise<SettingsSnapshot> {
    if (!isObject(patch)) throw new ValidationFailedException({ body: ['must be a JSON object'] });
    const workspaceId = this.requireWorkspace();
    const { config: current, configVersion } = await this.snapshot(workspaceId);

    const merged = mergeConfig(current as unknown as Json, patch);
    const checked = workspaceConfigSchema.safeParse(merged);
    if (!checked.success) throw new ValidationFailedException(zodIssuesToDetails(checked.error));
    const next = checked.data as unknown as WorkspaceConfig;

    const before = flatten(current);
    const after = flatten(next);
    const changedPaths = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
      (p) => JSON.stringify(before[p] ?? null) !== JSON.stringify(after[p] ?? null),
    );
    if (changedPaths.length === 0) return { config: current, configVersion };

    const nextVersion = await this.prisma.scoped.$transaction(async (tx) => {
      const written = await tx.workspace.updateMany({
        where: { id: workspaceId, configVersion },
        data: { config: next as never, configVersion: { increment: 1 } },
      });
      if (written.count === 0) {
        throw new AppException(
          'STALE_VERSION',
          409,
          'The settings were changed by someone else; reload and try again',
        );
      }
      await this.audit.record(tx, {
        action: 'settings.update',
        entityType: 'Workspace',
        entityId: workspaceId,
        before: Object.fromEntries(changedPaths.map((p) => [p, before[p] ?? null])),
        after: Object.fromEntries(changedPaths.map((p) => [p, after[p] ?? null])),
        metadata: { configVersion: configVersion + 1, changedPaths },
      });
      return configVersion + 1;
    });
    this.cls.set('settingsCache', undefined);
    return { config: next, configVersion: nextVersion };
  }

  private requireWorkspace(): string {
    const workspaceId = this.cls.get('workspaceId');
    if (!workspaceId) throw new Error('SettingsService needs a workspace in context');
    return workspaceId;
  }
}
