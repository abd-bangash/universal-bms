import { Injectable } from '@nestjs/common';
import { Prisma, type MessageTemplate } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ChannelRegistry } from '../channels/channel.registry';
import { IntegrationsService } from '../integrations/integrations.service';
import type { CreateTemplateDto, ListTemplatesQuery, UpdateTemplateDto } from './dto/messaging.dto';
import { TEMPLATE_VARIABLES, variablesOf } from './template-render';

export interface TemplateDto {
  id: string;
  name: string;
  kind: string;
  channel: string | null;
  body: string;
  variables: string[];
  providerName: string | null;
  language: string | null;
  providerStatus: string | null;
  active: boolean;
}

const toDto = (t: MessageTemplate): TemplateDto => ({
  id: t.id,
  name: t.name,
  kind: t.kind,
  channel: t.channel,
  body: t.body,
  variables: t.variables,
  providerName: t.providerName,
  language: t.language,
  providerStatus: t.providerStatus,
  active: t.active,
});

/** Quick replies, message templates, the bank-details message and the provider's approved templates. */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly channels: ChannelRegistry,
    private readonly integrations: IntegrationsService,
  ) {}

  async list(query: ListTemplatesQuery): Promise<TemplateDto[]> {
    const rows = await this.prisma.scoped.messageTemplate.findMany({
      where: {
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.active === undefined ? {} : { active: query.active }),
      },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toDto);
  }

  async get(id: string): Promise<MessageTemplate> {
    const row = await this.prisma.scoped.messageTemplate.findFirst({ where: { id } });
    if (!row) throw new NotFoundAppException();
    return row;
  }

  async create(user: AuthUser, dto: CreateTemplateDto): Promise<TemplateDto> {
    this.check(dto.kind, dto.body, dto);
    try {
      const row = await this.prisma.scoped.$transaction(async (tx) => {
        const created = await tx.messageTemplate.create({
          data: {
            workspaceId: user.workspaceId,
            name: dto.name.trim(),
            kind: dto.kind,
            channel: dto.channel ?? null,
            body: dto.body,
            variables: variablesOf(dto.body),
            providerName: dto.providerName ?? null,
            language: dto.language ?? null,
            providerStatus: dto.kind === 'PROVIDER' ? (dto.providerStatus ?? 'PENDING') : null,
            active: dto.active ?? true,
          },
        });
        await this.audit.record(tx, {
          action: 'template.create',
          entityType: 'MessageTemplate',
          entityId: created.id,
          after: { name: created.name, kind: created.kind },
        });
        return created;
      });
      return toDto(row);
    } catch (err) {
      throw this.nameTaken(err);
    }
  }

  async update(user: AuthUser, id: string, dto: UpdateTemplateDto): Promise<TemplateDto> {
    const current = await this.get(id);
    const merged = {
      body: dto.body ?? current.body,
      providerName: dto.providerName === undefined ? current.providerName : dto.providerName,
      language: dto.language === undefined ? current.language : dto.language,
    };
    this.check(current.kind, merged.body, merged);
    try {
      const row = await this.prisma.scoped.$transaction(async (tx) => {
        const updated = await tx.messageTemplate.update({
          where: { id },
          data: {
            ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
            ...(dto.channel === undefined ? {} : { channel: dto.channel }),
            ...(dto.body === undefined ? {} : { body: dto.body, variables: variablesOf(dto.body) }),
            ...(dto.providerName === undefined ? {} : { providerName: dto.providerName }),
            ...(dto.language === undefined ? {} : { language: dto.language }),
            ...(dto.providerStatus === undefined ? {} : { providerStatus: dto.providerStatus }),
            ...(dto.active === undefined ? {} : { active: dto.active }),
          },
        });
        await this.audit.record(tx, {
          action: 'template.update',
          entityType: 'MessageTemplate',
          entityId: id,
          before: { name: current.name, body: current.body, active: current.active },
          after: { name: updated.name, body: updated.body, active: updated.active },
        });
        return updated;
      });
      return toDto(row);
    } catch (err) {
      throw this.nameTaken(err);
    }
  }

  /** Reads the provider's own list of templates and keeps their name, language and approval status here. */
  async syncProvider(user: AuthUser, provider: string): Promise<TemplateDto[]> {
    const adapter = this.channels.get(provider);
    if (!adapter?.listTemplates) {
      throw new ValidationFailedException({ provider: ['does not have message templates'] });
    }
    const secrets = await this.integrations.secretsFor(adapter.provider);
    if (!secrets) {
      throw new AppException('VALIDATION_FAILED', 422, 'This provider is not connected');
    }
    const remote = await adapter.listTemplates(secrets.values);
    const saved: MessageTemplate[] = [];
    for (const t of remote) {
      const name = `${t.name} (${t.language})`;
      const row = await this.prisma.scoped.messageTemplate.upsert({
        where: { workspaceId_kind_name: { workspaceId: user.workspaceId, kind: 'PROVIDER', name } },
        create: {
          workspaceId: user.workspaceId,
          name,
          kind: 'PROVIDER',
          channel: adapter.provider,
          body: t.body,
          variables: variablesOf(t.body),
          providerName: t.name,
          language: t.language,
          providerStatus: t.status,
        },
        update: { body: t.body, variables: variablesOf(t.body), providerStatus: t.status },
      });
      saved.push(row);
    }
    await this.audit.recordAsync({
      action: 'template.sync',
      entityType: 'MessageTemplate',
      entityId: adapter.provider,
      metadata: { count: saved.length },
    });
    return saved.map(toDto);
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────

  /** Our own templates may only use the known variables; a provider's use its own numbered placeholders. */
  private check(
    kind: string,
    body: string,
    fields: { providerName?: string | null; language?: string | null },
  ): void {
    const errors: Record<string, string[]> = {};
    if (kind === 'PROVIDER') {
      if (!fields.providerName) errors.providerName = ['is required for a provider template'];
      if (!fields.language) errors.language = ['is required for a provider template'];
    } else {
      const unknown = variablesOf(body).filter(
        (v) => !(TEMPLATE_VARIABLES as readonly string[]).includes(v),
      );
      if (unknown.length > 0) {
        errors.body = [
          `uses unknown variables: ${unknown.join(', ')}. Allowed: ${TEMPLATE_VARIABLES.join(', ')}`,
        ];
      }
    }
    if (Object.keys(errors).length > 0) throw new ValidationFailedException(errors);
  }

  private nameTaken(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new AppException(
        'VALIDATION_FAILED',
        422,
        'A template with this name already exists',
        {
          name: ['is already used by another template of this kind'],
        },
      );
    }
    return err;
  }
}
