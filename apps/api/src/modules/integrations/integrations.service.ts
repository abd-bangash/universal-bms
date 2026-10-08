import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type IntegrationConnection } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  ExternalServiceException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ENV, type Env } from '../../config/env';
import { AuditService } from '../audit/audit.service';
import { AdapterRunner } from './adapter-runner';
import type { ConnectIntegrationDto } from './dto/integrations.dto';
import {
  IntegrationProviderRegistry,
  type HealthResult,
  type ProviderDefinition,
} from './integration-provider.registry';
import { decryptJson, encryptJson, mask } from './secret-box';

export interface IntegrationFieldView {
  key: string;
  label: string;
  secret: boolean;
  /** Secrets arrive masked; everything else as stored. */
  value: string;
}

export interface IntegrationDto {
  id: string;
  provider: string;
  providerLabel: string;
  type: string;
  status: string;
  displayName: string | null;
  externalAccountId: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  fields: IntegrationFieldView[];
}

export interface ProviderView {
  provider: string;
  type: string;
  label: string;
  fields: Array<{ key: string; label: string; secret: boolean; required: boolean }>;
}

export interface TestResult extends HealthResult {
  /** A normalized failure code, never the provider's own text. */
  code?: string;
}

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly providers: IntegrationProviderRegistry,
    private readonly runner: AdapterRunner,
    @Inject(ENV) private readonly env: Env,
  ) {}

  providerCatalogue(): ProviderView[] {
    return this.providers.all().map((p) => ({
      provider: p.provider,
      type: p.type,
      label: p.label,
      fields: p.fields.map((f) => ({ ...f })),
    }));
  }

  async list(): Promise<IntegrationDto[]> {
    const rows = await this.prisma.scoped.integrationConnection.findMany({
      orderBy: [{ provider: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string): Promise<IntegrationDto> {
    return this.toDto(await this.row(id));
  }

  /** Connects a provider, or reconnects it with new credentials. Secrets are encrypted before they are stored. */
  async connect(user: AuthUser, dto: ConnectIntegrationDto): Promise<IntegrationDto> {
    const def = this.definition(dto.provider);
    const values = this.checkedValues(def, dto.values);
    const externalAccountId = def.accountIdField ? (values[def.accountIdField] ?? null) : null;
    const encrypted = encryptJson(this.env.INTEGRATION_ENCRYPTION_KEY, values);
    try {
      const saved = await this.prisma.scoped.$transaction(async (tx) => {
        const existing = await tx.integrationConnection.findFirst({
          where: { provider: def.provider },
        });
        const row = existing
          ? await tx.integrationConnection.update({
              where: { id: existing.id },
              data: {
                status: 'CONNECTED',
                displayName: dto.displayName?.trim() || existing.displayName,
                externalAccountId,
                configEncrypted: encrypted,
                lastError: null,
                lastErrorAt: null,
              },
            })
          : await tx.integrationConnection.create({
              data: {
                workspaceId: user.workspaceId,
                provider: def.provider,
                type: def.type,
                displayName: dto.displayName?.trim() || def.label,
                externalAccountId,
                configEncrypted: encrypted,
              },
            });
        await this.audit.record(tx, {
          action: existing ? 'integration.reconnect' : 'integration.connect',
          entityType: 'IntegrationConnection',
          entityId: row.id,
          // no credentials in the trail: only which provider and which account
          after: { provider: def.provider, externalAccountId },
        });
        return row;
      });
      return this.toDto(saved);
    } catch (err) {
      // the account is already connected to a workspace, possibly another one: say no more than that
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppException(
          'VALIDATION_FAILED',
          422,
          'This account is already connected and cannot be connected again',
          { [def.accountIdField ?? 'values']: ['is already connected'] },
        );
      }
      throw err;
    }
  }

  /** Tries the credentials against the provider. The answer is a result, not an error, so a screen can show it. */
  async test(id: string): Promise<TestResult> {
    const row = await this.row(id);
    if (row.status === 'DISCONNECTED') {
      throw new AppException('VALIDATION_FAILED', 422, 'This connection has been disconnected');
    }
    const def = this.definition(row.provider);
    let values: Record<string, string>;
    try {
      values = this.secretsOf(row);
    } catch {
      throw new AppException(
        'VALIDATION_FAILED',
        422,
        'The saved credentials cannot be read; connect this provider again',
      );
    }
    try {
      const result = await this.runner.run(row.provider, 'testConnection', () => def.test(values), {
        connectionId: row.id,
      });
      return { ok: result.ok, ...(result.detail ? { detail: result.detail } : {}) };
    } catch (err) {
      if (err instanceof ExternalServiceException) {
        return { ok: false, code: err.normalizedCode };
      }
      throw err;
    }
  }

  /** Forgets the credentials and stops using the connection; conversations that came through it stay. */
  async disconnect(id: string): Promise<IntegrationDto> {
    const row = await this.row(id);
    return this.prisma.scoped.$transaction(async (tx) => {
      const updated = await tx.integrationConnection.update({
        where: { id },
        data: {
          status: 'DISCONNECTED',
          configEncrypted: encryptJson(this.env.INTEGRATION_ENCRYPTION_KEY, {}),
          externalAccountId: null,
        },
      });
      await this.audit.record(tx, {
        action: 'integration.disconnect',
        entityType: 'IntegrationConnection',
        entityId: id,
        before: { provider: row.provider, status: row.status },
        after: { status: 'DISCONNECTED' },
      });
      return this.toDto(updated);
    });
  }

  /** The decrypted credentials of a connected provider, for adapters only; never sent to a client. */
  async secretsFor(
    provider: string,
  ): Promise<{ connectionId: string; values: Record<string, string> } | null> {
    const row = await this.prisma.scoped.integrationConnection.findFirst({
      where: { provider, status: { not: 'DISCONNECTED' } },
    });
    return row ? { connectionId: row.id, values: this.secretsOf(row) } : null;
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────

  secretsOf(row: IntegrationConnection): Record<string, string> {
    return decryptJson(this.env.INTEGRATION_ENCRYPTION_KEY, row.configEncrypted);
  }

  private async row(id: string): Promise<IntegrationConnection> {
    const row = await this.prisma.scoped.integrationConnection.findFirst({ where: { id } });
    if (!row) throw new NotFoundAppException();
    return row;
  }

  private definition(provider: string): ProviderDefinition {
    const def = this.providers.get(provider);
    if (!def) throw new ValidationFailedException({ provider: ['is not a supported provider'] });
    return def;
  }

  private checkedValues(
    def: ProviderDefinition,
    input: Record<string, string>,
  ): Record<string, string> {
    const errors: Record<string, string[]> = {};
    const known = new Set(def.fields.map((f) => f.key));
    for (const key of Object.keys(input)) {
      if (!known.has(key)) errors[key] = ['is not a setting of this provider'];
    }
    const values: Record<string, string> = {};
    for (const field of def.fields) {
      const value = input[field.key];
      if (typeof value !== 'string' || value.trim() === '') {
        if (field.required) errors[field.key] = ['is required'];
        continue;
      }
      values[field.key] = value.trim();
    }
    if (Object.keys(errors).length > 0) throw new ValidationFailedException(errors);
    return values;
  }

  private toDto(row: IntegrationConnection): IntegrationDto {
    const def = this.providers.get(row.provider);
    let values: Record<string, string> = {};
    try {
      values = row.status === 'DISCONNECTED' ? {} : this.secretsOf(row);
    } catch {
      // credentials that cannot be read are shown as missing rather than failing the whole list
    }
    return {
      id: row.id,
      provider: row.provider,
      providerLabel: def?.label ?? row.provider,
      type: row.type,
      status: row.status,
      displayName: row.displayName,
      externalAccountId: row.externalAccountId,
      lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
      lastErrorAt: row.lastErrorAt ? row.lastErrorAt.toISOString() : null,
      lastError: row.lastError,
      fields: (def?.fields ?? []).map((f) => ({
        key: f.key,
        label: f.label,
        secret: f.secret,
        value:
          values[f.key] === undefined
            ? ''
            : f.secret
              ? mask(values[f.key] as string)
              : (values[f.key] as string),
      })),
    };
  }
}
