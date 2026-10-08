import { Injectable } from '@nestjs/common';
import { Prisma, type Conversation, type Message } from '@prisma/client';
import type { ChannelProvider, OutboundContent } from '@bms/types';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  ExternalServiceException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { DomainEventBus } from '../../common/events/domain-event-bus';
import { keysetCursor, keysetWhere, toPage, type Page } from '../../common/pagination/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ChannelRegistry } from '../channels/channel.registry';
import { ChannelInboundService } from '../channels/channel-inbound.service';
import { DocumentsService } from '../documents/documents.service';
import { FilesService } from '../files/files.service';
import { AdapterRunner } from '../integrations/adapter-runner';
import { IntegrationsService } from '../integrations/integrations.service';
import { QueueService } from '../queue/queue.service';
import type { JobInfo } from '../queue/queue.types';
import { SettingsService } from '../settings/settings.service';
import type {
  AttachmentRefDto,
  ListConversationsQuery,
  ListMessagesQuery,
  SendMessageDto,
  UpdateConversationDto,
} from './dto/messaging.dto';
import { TemplateContextService } from './template-context.service';
import { renderTemplate, variablesOf } from './template-render';
import { TemplatesService } from './templates.service';

export const OUTBOUND_ATTEMPTS = 3;
export const OUTBOUND_BACKOFF_MS = 5_000;

export interface ConversationDto {
  id: string;
  channelType: string;
  status: string;
  contactName: string | null;
  contactPhone: string | null;
  externalContactId: string;
  customerId: string | null;
  customerName: string | null;
  leadId: string | null;
  leadName: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  unreadCount: number;
  automationActive: boolean;
  /** Automation runs only when the workspace allows it AND this conversation has it on. */
  automationEffective: boolean;
  aiEnabled: boolean;
  needsHuman: boolean;
  needsHumanReason: string | null;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: 'INBOUND' | 'OUTBOUND' | null;
  /** Whether a free-form message may be sent now, or only an approved template. */
  canSendFreeform: boolean;
  optedOut: boolean;
}

export interface MessageDto {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderType: string;
  senderUserId: string | null;
  senderName: string | null;
  type: string;
  body: string | null;
  attachments: Array<{ fileId: string; name: string; mime: string }>;
  templateId: string | null;
  status: string;
  failureReason: string | null;
  providerTimestamp: string;
  channelMeta: unknown;
}

type ConversationRow = Conversation & {
  customer: { fullName: string } | null;
  lead: { fullName: string; assignedToId: string | null } | null;
  assignedTo: { firstName: string; lastName: string } | null;
};

const INCLUDE = {
  customer: { select: { fullName: true } },
  lead: { select: { fullName: true, assignedToId: true } },
  assignedTo: { select: { firstName: true, lastName: true } },
} as const;

/** What the outbound queue needs to rebuild a message for the provider. */
type Outbound =
  | { kind: 'text' }
  | { kind: 'media'; fileId: string; mediaType: 'image' | 'document'; filename: string }
  | { kind: 'template'; name: string; language: string; parameters: string[] };

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly channels: ChannelRegistry,
    private readonly inbound: ChannelInboundService,
    private readonly integrations: IntegrationsService,
    private readonly runner: AdapterRunner,
    private readonly queues: QueueService,
    private readonly events: DomainEventBus,
    private readonly settings: SettingsService,
    private readonly templates: TemplatesService,
    private readonly context: TemplateContextService,
    private readonly documents: DocumentsService,
    private readonly files: FilesService,
  ) {}

  // ── reading ─────────────────────────────────────────────────────────────────────────────

  /** Without `conversation:view_all` a person sees the conversations assigned to them (or to their lead). */
  private scope(user: AuthUser): Prisma.ConversationWhereInput {
    return user.permissions.includes('conversation:view_all')
      ? {}
      : { OR: [{ assignedToId: user.userId }, { lead: { assignedToId: user.userId } }] };
  }

  async list(user: AuthUser, query: ListConversationsQuery): Promise<Page<ConversationDto>> {
    const filters: Prisma.ConversationWhereInput[] = [this.scope(user)];
    if (query.status) filters.push({ status: query.status });
    if (query.assigned === 'me') filters.push({ assignedToId: user.userId });
    else if (query.assigned === 'none') filters.push({ assignedToId: null });
    else if (query.assigned) filters.push({ assignedToId: query.assigned });
    if (query.unread) filters.push({ unreadCount: { gt: 0 } });
    if (query.needsHuman) filters.push({ needsHuman: true });
    if (query.customerId) filters.push({ customerId: query.customerId });
    if (query.leadId) filters.push({ leadId: query.leadId });
    if (query.q?.trim()) {
      const text = { contains: query.q.trim(), mode: 'insensitive' as const };
      filters.push({
        OR: [
          { contactName: text },
          { contactPhone: text },
          { customer: { fullName: text } },
          { lead: { fullName: text } },
        ],
      });
    }
    const after = keysetWhere('lastMessageAt', 'desc', query.cursor, true);
    if (after) filters.push(after as Prisma.ConversationWhereInput);

    const rows = await this.prisma.scoped.conversation.findMany({
      where: { AND: filters },
      include: INCLUDE,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = toPage(rows, query.limit, (last) =>
      keysetCursor(last.lastMessageAt ?? new Date(0), last.id),
    );
    const dtos = await this.toDtos(page.items);
    const byId = new Map(dtos.map((d) => [d.id, d]));
    return page.map((r) => byId.get(r.id) as ConversationDto);
  }

  async get(user: AuthUser, id: string): Promise<ConversationDto> {
    const row = await this.row(user, id);
    return (await this.toDtos([row]))[0] as ConversationDto;
  }

  /** How many conversations in the person's view have something unread (the badge on the inbox link). */
  async unreadCount(user: AuthUser): Promise<{ conversations: number }> {
    const conversations = await this.prisma.scoped.conversation.count({
      where: { AND: [this.scope(user), { unreadCount: { gt: 0 } }] },
    });
    return { conversations };
  }

  async messages(user: AuthUser, id: string, query: ListMessagesQuery): Promise<Page<MessageDto>> {
    await this.row(user, id);
    const after = keysetWhere('providerTimestamp', 'desc', query.cursor, true);
    const rows = await this.prisma.scoped.message.findMany({
      where: {
        AND: [{ conversationId: id }, ...(after ? [after as Prisma.MessageWhereInput] : [])],
      },
      orderBy: [{ providerTimestamp: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = toPage(rows, query.limit, (last) => keysetCursor(last.providerTimestamp, last.id));
    const names = await this.userNames(page.items.map((m) => m.senderUserId));
    return page.map((m) => toMessageDto(m, names));
  }

  async markRead(user: AuthUser, id: string): Promise<ConversationDto> {
    await this.row(user, id);
    await this.prisma.scoped.conversation.update({ where: { id }, data: { unreadCount: 0 } });
    return this.get(user, id);
  }

  // ── changing ────────────────────────────────────────────────────────────────────────────

  async update(user: AuthUser, id: string, dto: UpdateConversationDto): Promise<ConversationDto> {
    const current = await this.row(user, id);
    const data: Prisma.ConversationUncheckedUpdateInput = {};

    if (dto.assignedToId !== undefined) {
      this.need(user, 'conversation:assign');
      if (dto.assignedToId) {
        const member = await this.prisma.scoped.userWorkspace.findFirst({
          where: { userId: dto.assignedToId, status: 'ACTIVE' },
        });
        if (!member) {
          throw new ValidationFailedException({
            assignedToId: ['must be an active member of this workspace'],
          });
        }
      }
      data.assignedToId = dto.assignedToId;
    }
    if (dto.customerId !== undefined) {
      this.need(user, 'conversation:assign');
      const customer = await this.prisma.scoped.customer.findFirst({
        where: { id: dto.customerId, mergedIntoId: null },
        select: { id: true },
      });
      if (!customer) throw new ValidationFailedException({ customerId: ['does not exist'] });
      data.customerId = customer.id;
    }
    if (dto.leadId !== undefined) {
      this.need(user, 'conversation:assign');
      const lead = await this.prisma.scoped.lead.findFirst({
        where: { id: dto.leadId },
        select: { id: true },
      });
      if (!lead) throw new ValidationFailedException({ leadId: ['does not exist'] });
      data.leadId = lead.id;
    }
    if (dto.status !== undefined) {
      this.need(user, 'conversation:reply');
      data.status = dto.status;
    }
    if (dto.automationActive !== undefined) {
      // taking over needs only the right to reply; handing a conversation back to automation is configuration
      this.need(user, dto.automationActive ? 'automation:configure' : 'conversation:reply');
      data.automationActive = dto.automationActive;
    }
    if (dto.aiEnabled !== undefined) {
      this.need(user, 'ai:control');
      data.aiEnabled = dto.aiEnabled;
    }
    if (Object.keys(data).length === 0) return this.get(user, id);

    await this.prisma.scoped.$transaction(async (tx) => {
      const updated = await tx.conversation.update({ where: { id }, data });
      await this.audit.record(tx, {
        action: 'conversation.update',
        entityType: 'Conversation',
        entityId: id,
        before: pick(current, Object.keys(data)),
        after: pick(updated, Object.keys(data)),
      });
    });
    return this.get(user, id);
  }

  // ── sending ─────────────────────────────────────────────────────────────────────────────

  /**
   * Queues a reply. Free text, a quick reply or template, and/or documents and images; each
   * attachment is its own message on the provider. A person writing to the customer takes the
   * conversation over from automation.
   */
  async send(user: AuthUser, id: string, dto: SendMessageDto): Promise<MessageDto[]> {
    const conversation = await this.row(user, id);
    const body = dto.body?.trim() ?? '';
    const attachments = dto.attachments ?? [];
    if (!body && !dto.templateId && attachments.length === 0) {
      throw new ValidationFailedException({
        body: ['write a message, or choose a template or a file'],
      });
    }
    if (dto.templateId && body) {
      throw new ValidationFailedException({ body: ['cannot be combined with a template'] });
    }
    const connection = await this.prisma.scoped.integrationConnection.findFirst({
      where: { id: conversation.connectionId },
    });
    if (!connection || connection.status === 'DISCONNECTED') {
      throw new AppException('VALIDATION_FAILED', 422, 'This channel is disconnected');
    }
    const adapter = this.channels.require(conversation.channelType as ChannelProvider);
    const freeform = adapter.canSendFreeform({ lastInboundAt: conversation.lastInboundAt });

    // what goes out, decided and checked before anything is stored
    const parts: Array<{
      type: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'TEMPLATE';
      body: string | null;
      templateId: string | null;
      attachments: Array<{ fileId: string; name: string; mime: string }>;
      outbound: Outbound;
    }> = [];

    if (dto.templateId) {
      const template = await this.templates.get(dto.templateId);
      if (!template.active) {
        throw new ValidationFailedException({ templateId: ['is switched off'] });
      }
      if (await this.optedOut(conversation)) {
        throw new AppException(
          'CONTACT_OPTED_OUT',
          422,
          'This contact has opted out of template messages',
        );
      }
      const values = await this.context.values(conversation, dto.orderId);
      if (template.kind === 'PROVIDER') {
        if (template.providerStatus !== 'APPROVED') {
          throw new ValidationFailedException({ templateId: ['is not approved by the provider'] });
        }
        const names = variablesOf(template.body);
        const parameters: string[] = [];
        const missing: string[] = [];
        names.forEach((name, i) => {
          const given = /^\d+$/.test(name) ? dto.parameters?.[Number(name) - 1] : values[name];
          if (given === undefined || given.trim() === '') missing.push(name);
          else parameters[i] = given;
        });
        if (missing.length > 0) this.unresolved(missing);
        const rendered = renderTemplate(
          template.body,
          Object.fromEntries(names.map((n, i) => [n, parameters[i]])),
        );
        parts.push({
          type: 'TEMPLATE',
          body: rendered.text,
          templateId: template.id,
          attachments: [],
          outbound: {
            kind: 'template',
            name: template.providerName as string,
            language: template.language as string,
            parameters,
          },
        });
      } else {
        const rendered = renderTemplate(template.body, values);
        if (rendered.unresolved.length > 0) this.unresolved(rendered.unresolved);
        if (!freeform) this.windowClosed();
        parts.push({
          type: 'TEXT',
          body: rendered.text,
          templateId: template.id,
          attachments: [],
          outbound: { kind: 'text' },
        });
      }
    } else if (body && attachments.length === 0) {
      if (!freeform) this.windowClosed();
      parts.push({
        type: 'TEXT',
        body,
        templateId: null,
        attachments: [],
        outbound: { kind: 'text' },
      });
    }

    if (attachments.length > 0 && !freeform) this.windowClosed();
    for (const [i, ref] of attachments.entries()) {
      const file = await this.attachment(user, ref);
      const image = file.mime.startsWith('image/');
      parts.push({
        type: image ? 'IMAGE' : 'DOCUMENT',
        // the typed text rides along as the caption of the first file
        body: i === 0 && body ? body : null,
        templateId: null,
        attachments: [file],
        outbound: {
          kind: 'media',
          fileId: file.fileId,
          mediaType: image ? 'image' : 'document',
          filename: file.name,
        },
      });
    }

    const now = new Date();
    const created = await this.prisma.scoped.$transaction(async (tx) => {
      const rows: Message[] = [];
      for (const [i, part] of parts.entries()) {
        rows.push(
          await tx.message.create({
            data: {
              workspaceId: user.workspaceId,
              conversationId: conversation.id,
              direction: 'OUTBOUND',
              senderType: 'STAFF',
              senderUserId: user.userId,
              type: part.type,
              body: part.body,
              attachments: part.attachments as unknown as Prisma.InputJsonValue,
              templateId: part.templateId,
              status: 'QUEUED',
              // later messages sort after earlier ones even inside one millisecond
              providerTimestamp: new Date(now.getTime() + i),
              channelMeta: { outbound: part.outbound } as Prisma.InputJsonValue,
            },
          }),
        );
      }
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: new Date(now.getTime() + parts.length - 1),
          automationActive: false, // a person has taken over
          needsHuman: false,
          needsHumanReason: null,
          ...(conversation.status === 'CLOSED' ? { status: 'OPEN' } : {}),
        },
      });
      await this.audit.record(tx, {
        action: 'conversation.message_send',
        entityType: 'Conversation',
        entityId: conversation.id,
        metadata: { messages: rows.length, template: dto.templateId ?? null },
      });
      return rows;
    });

    for (const message of created) {
      await this.queues.add('channel.outbound', 'send', {
        workspaceId: user.workspaceId,
        actorUserId: user.userId,
        messageId: message.id,
      });
      await this.events.publish('conversation.message_sent', {
        workspaceId: user.workspaceId,
        actorUserId: user.userId,
        conversationId: conversation.id,
        messageId: message.id,
      });
    }
    const fresh = await this.prisma.scoped.message.findMany({
      where: { id: { in: created.map((m) => m.id) } },
      orderBy: { providerTimestamp: 'asc' },
    });
    const names = await this.userNames([user.userId]);
    return fresh.map((m) => toMessageDto(m, names));
  }

  /** `channel.outbound`: hands one queued message to the provider. Safe to run twice. */
  async deliver(messageId: string, job: JobInfo): Promise<void> {
    const message = await this.prisma.scoped.message.findFirst({
      where: { id: messageId },
      include: { conversation: { include: { connection: true } } },
    });
    if (!message || message.status !== 'QUEUED') return;
    const { conversation } = message;
    const connection = conversation.connection;
    const workspaceId = message.workspaceId;
    if (connection.status === 'DISCONNECTED') {
      await this.fail(message, 'CHANNEL_DISCONNECTED');
      return;
    }
    const adapter = this.channels.require(conversation.channelType as ChannelProvider);
    try {
      const secrets = this.integrations.secretsOf(connection);
      const content = await this.contentOf(message);
      const to = conversation.contactPhone ?? conversation.externalContactId;
      const sent = await this.runner.run(
        connection.provider,
        'sendMessage',
        () => adapter.sendMessage(secrets, to, content),
        { connectionId: connection.id },
      );
      await this.prisma.scoped.message.updateMany({
        where: { id: message.id, status: 'QUEUED' },
        data: { externalId: sent.externalMessageId, status: 'SENT' },
      });
      // a delivery report can beat us to it; apply any that are waiting
      await this.inbound.reapplyStatuses(workspaceId, sent.externalMessageId);
    } catch (err) {
      if (job.attemptsMade + 1 >= OUTBOUND_ATTEMPTS) {
        await this.fail(
          message,
          err instanceof ExternalServiceException ? err.normalizedCode : 'SEND_FAILED',
        );
      }
      throw err;
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────

  private async fail(message: Message, reason: string): Promise<void> {
    await this.prisma.scoped.message.updateMany({
      where: { id: message.id, status: 'QUEUED' },
      data: { status: 'FAILED', failureReason: reason },
    });
    await this.events.publish('conversation.message_status', {
      workspaceId: message.workspaceId,
      conversationId: message.conversationId,
      messageId: message.id,
    });
  }

  private async contentOf(message: Message): Promise<OutboundContent> {
    const stored = (message.channelMeta as { outbound?: Outbound } | null)?.outbound;
    if (!stored || stored.kind === 'text') return { kind: 'text', body: message.body ?? '' };
    if (stored.kind === 'template') {
      return {
        kind: 'template',
        name: stored.name,
        language: stored.language,
        parameters: stored.parameters,
      };
    }
    return {
      kind: 'media',
      mediaType: stored.mediaType,
      link: await this.files.linkFor(stored.fileId),
      filename: stored.filename,
      ...(message.body ? { caption: message.body } : {}),
    };
  }

  /** A file or a PDF of a quotation, invoice or receipt, kept in the workspace for sending. */
  private async attachment(
    user: AuthUser,
    ref: AttachmentRefDto,
  ): Promise<{ fileId: string; name: string; mime: string }> {
    if (ref.type === 'FILE') {
      const file = await this.prisma.scoped.fileAsset.findFirst({ where: { id: ref.id } });
      if (!file) throw new ValidationFailedException({ attachments: ['a file does not exist'] });
      // once it is in a conversation, everyone who can read the conversation can open it
      if (!file.entityType) {
        await this.prisma.scoped.fileAsset.update({
          where: { id: file.id },
          data: { entityType: 'MESSAGE' },
        });
      }
      return { fileId: file.id, name: file.originalName, mime: file.mimeType };
    }
    const pdf =
      ref.type === 'QUOTATION'
        ? (this.need(user, 'quotation:view'), await this.documents.quotationPdf(ref.id))
        : ref.type === 'INVOICE'
          ? (this.need(user, 'order:view'), await this.documents.invoicePdf(user, ref.id))
          : (this.need(user, 'pos:sell'), await this.documents.receiptPdf(ref.id));
    const stored = await this.files.storeSystemFile(user.workspaceId, {
      buffer: pdf.buffer,
      name: pdf.filename,
    });
    if (!stored)
      throw new AppException('INTERNAL_ERROR', 500, 'The document could not be prepared');
    return { fileId: stored.id, name: stored.name, mime: stored.mime };
  }

  private async optedOut(conversation: Conversation): Promise<boolean> {
    const consent = await this.prisma.scoped.contactConsent.findFirst({
      where: {
        channelType: conversation.channelType,
        externalContactId: conversation.externalContactId,
      },
    });
    return consent?.status === 'OPTED_OUT';
  }

  private windowClosed(): never {
    throw new AppException(
      'FREEFORM_WINDOW_CLOSED',
      422,
      'The customer last wrote more than 24 hours ago: only an approved template can be sent now',
    );
  }

  private unresolved(names: string[]): never {
    throw new AppException(
      'UNRESOLVED_TEMPLATE_VARIABLE',
      422,
      `The message has no value for: ${names.join(', ')}`,
      { variables: names },
    );
  }

  private need(user: AuthUser, permission: string): void {
    if (!user.permissions.includes(permission)) {
      throw new AppException('PERMISSION_DENIED', 403, 'You do not have permission to do this');
    }
  }

  private async row(user: AuthUser, id: string): Promise<ConversationRow> {
    const row = await this.prisma.scoped.conversation.findFirst({
      where: { AND: [{ id }, this.scope(user)] },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundAppException();
    return row;
  }

  private async userNames(ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.scoped.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  }

  private async toDtos(rows: ConversationRow[]): Promise<ConversationDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [latest, consents, workspaceAutomation] = await Promise.all([
      this.prisma.scoped.message.findMany({
        where: { conversationId: { in: ids } },
        orderBy: [{ providerTimestamp: 'desc' }, { id: 'desc' }],
        distinct: ['conversationId'],
        select: { conversationId: true, body: true, type: true, direction: true },
      }),
      this.prisma.scoped.contactConsent.findMany({ where: { status: 'OPTED_OUT' } }),
      this.settings.get<boolean | undefined>('messaging.automationEnabled'),
    ]);
    const lastBy = new Map(latest.map((m) => [m.conversationId, m]));
    const optedOut = new Set(consents.map((c) => `${c.channelType}|${c.externalContactId}`));
    return rows.map((r) => {
      const last = lastBy.get(r.id);
      const adapter = this.channels.get(r.channelType);
      return {
        id: r.id,
        channelType: r.channelType,
        status: r.status,
        contactName: r.contactName,
        contactPhone: r.contactPhone,
        externalContactId: r.externalContactId,
        customerId: r.customerId,
        customerName: r.customer?.fullName ?? null,
        leadId: r.leadId,
        leadName: r.lead?.fullName ?? null,
        assignedToId: r.assignedToId,
        assignedToName: r.assignedTo
          ? `${r.assignedTo.firstName} ${r.assignedTo.lastName}`.trim()
          : null,
        unreadCount: r.unreadCount,
        automationActive: r.automationActive,
        automationEffective: Boolean(workspaceAutomation) && r.automationActive,
        aiEnabled: r.aiEnabled,
        needsHuman: r.needsHuman,
        needsHumanReason: r.needsHumanReason,
        lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
        lastInboundAt: r.lastInboundAt?.toISOString() ?? null,
        lastMessagePreview: last
          ? (last.body ?? `[${last.type.toLowerCase()}]`).slice(0, 120)
          : null,
        lastMessageDirection: last?.direction ?? null,
        canSendFreeform: adapter
          ? adapter.canSendFreeform({ lastInboundAt: r.lastInboundAt })
          : false,
        optedOut: optedOut.has(`${r.channelType}|${r.externalContactId}`),
      };
    });
  }
}

function toMessageDto(m: Message, names: Map<string, string>): MessageDto {
  return {
    id: m.id,
    direction: m.direction,
    senderType: m.senderType,
    senderUserId: m.senderUserId,
    senderName: m.senderUserId ? (names.get(m.senderUserId) ?? null) : null,
    type: m.type,
    body: m.body,
    attachments: (m.attachments as MessageDto['attachments']) ?? [],
    templateId: m.templateId,
    status: m.status,
    failureReason: m.failureReason,
    providerTimestamp: m.providerTimestamp.toISOString(),
    channelMeta: m.channelMeta,
  };
}

function pick(row: object, keys: string[]): Record<string, unknown> {
  const source = row as Record<string, unknown>;
  return Object.fromEntries(keys.map((k) => [k, source[k] ?? null]));
}
