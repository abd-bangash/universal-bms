import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type Conversation,
  type IntegrationConnection,
  type Message,
} from '@prisma/client';
import type { Logger } from 'pino';
import type { NormalizedEvent } from '@bms/types';
import { DomainEventBus } from '../../common/events/domain-event-bus';
import { LOGGER } from '../../common/logging/app-logger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';
import { LeadsService } from '../crm/leads.service';
import { normalizePhone, PhoneService } from '../crm/phone.service';
import { SettingsService } from '../settings/settings.service';
import { IntegrationsService } from '../integrations/integrations.service';
import type { JobInfo } from '../queue/queue.types';
import { ChannelRegistry } from './channel.registry';

/** A job gets this many tries: the first, and three retries with growing waits (design.md, inbound step 4). */
export const INBOUND_ATTEMPTS = 4;
export const INBOUND_BACKOFF_MS = 30_000;

/**
 * How far a delivery status has got. A status only ever moves a message forward, so the same set of
 * events gives the same result in any order. `FAILED` sits above `SENT` (a message that was sent can
 * still fail) and below `DELIVERED` (a delivered message cannot have failed).
 */
const STATUS_RANK: Record<string, number> = {
  QUEUED: 0,
  SENT: 1,
  FAILED: 2,
  DELIVERED: 3,
  READ: 4,
};

const OPT_IN = new Set(['START', 'SUBSCRIBE', 'UNSTOP', 'OPT IN', 'OPTIN']);

type MessageEvent = Extract<NormalizedEvent, { kind: 'message' }>;
type StatusEvent = Extract<NormalizedEvent, { kind: 'status' }>;
type LeadFormEvent = Extract<NormalizedEvent, { kind: 'lead_form' }>;

/** A delivery status for a message we do not know yet: it is retried, since the status can outrun the message. */
export class MessageNotKnownError extends Error {
  constructor(externalId: string) {
    super(`Message ${externalId} is not known yet`);
  }
}

export interface InboundPayload {
  workspaceId: string;
  webhookEventId: string;
  [key: string]: unknown;
}

/**
 * Handles one stored webhook event inside its workspace's context (`channel.inbound`): turns a
 * provider's message into a conversation, a message and a contact to follow up, or moves a
 * message's delivery status forward. Every step is safe to run twice.
 */
@Injectable()
export class ChannelInboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelRegistry,
    private readonly integrations: IntegrationsService,
    private readonly files: FilesService,
    private readonly leads: LeadsService,
    private readonly phones: PhoneService,
    private readonly settings: SettingsService,
    private readonly events: DomainEventBus,
    private readonly audit: AuditService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async process(payload: InboundPayload, job: JobInfo): Promise<void> {
    const stored = await this.prisma.scoped.webhookEvent.findUnique({
      where: { id: payload.webhookEventId },
    });
    if (!stored || stored.workspaceId !== payload.workspaceId) return;
    if (stored.status === 'PROCESSED' || stored.status === 'IGNORED') return;

    const connection = stored.connectionId
      ? await this.prisma.scoped.integrationConnection.findFirst({
          where: { id: stored.connectionId },
        })
      : null;
    if (!connection || connection.status === 'DISCONNECTED') {
      await this.finish(stored.id, 'IGNORED');
      return;
    }

    try {
      await this.handle(connection, revive(stored.payload));
      await this.finish(stored.id, 'PROCESSED');
      await this.prisma.scoped.integrationConnection.update({
        where: { id: connection.id },
        data: { lastSuccessAt: new Date() },
      });
    } catch (err) {
      await this.failed(stored.id, connection, err, job.attemptsMade + 1 >= INBOUND_ATTEMPTS);
      throw err;
    }
  }

  /**
   * Applies the delivery statuses that arrived before the message was known (or before its id was
   * stored). Called when a message gets its provider id.
   */
  async reapplyStatuses(workspaceId: string, externalId: string): Promise<void> {
    const waiting = await this.prisma.scoped.webhookEvent.findMany({
      where: {
        workspaceId,
        kind: 'status',
        status: { in: ['RECEIVED', 'FAILED'] },
        payload: { path: ['externalMessageId'], equals: externalId },
      },
      orderBy: { receivedAt: 'asc' },
    });
    for (const row of waiting) {
      const connection = row.connectionId
        ? await this.prisma.scoped.integrationConnection.findFirst({
            where: { id: row.connectionId },
          })
        : null;
      if (!connection) continue;
      try {
        await this.onStatus(connection, revive(row.payload) as StatusEvent);
        await this.finish(row.id, 'PROCESSED');
      } catch (err) {
        if (!(err instanceof MessageNotKnownError)) throw err;
      }
    }
  }

  // ── events ──────────────────────────────────────────────────────────────────────────────

  private async handle(connection: IntegrationConnection, event: NormalizedEvent): Promise<void> {
    switch (event.kind) {
      case 'message':
        return this.onMessage(connection, event);
      case 'status':
        return this.onStatus(connection, event);
      case 'lead_form':
        return this.onLeadForm(connection, event);
    }
  }

  private async onMessage(connection: IntegrationConnection, event: MessageEvent): Promise<void> {
    const workspaceId = connection.workspaceId;
    const conversation = await this.conversationFor(connection, event);

    const known = await this.prisma.scoped.message.findFirst({
      where: { conversationId: conversation.id, externalId: event.externalMessageId },
      select: { id: true },
    });
    if (known) return; // delivered before

    const attachments = await this.fetchMedia(connection, event);
    let message: Message;
    try {
      message = await this.prisma.scoped.message.create({
        data: {
          workspaceId,
          conversationId: conversation.id,
          externalId: event.externalMessageId,
          direction: 'INBOUND',
          senderType: 'CUSTOMER',
          type: event.type,
          body: event.body ?? null,
          attachments: attachments as unknown as Prisma.InputJsonValue,
          status: 'RECEIVED',
          providerTimestamp: event.timestamp,
          channelMeta: {
            ...(event.location ? { location: event.location } : {}),
            ...(event.media && attachments.length < event.media.length
              ? { mediaNotStored: event.media.length - attachments.length }
              : {}),
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
      throw err;
    }

    await this.touchConversation(conversation, event.timestamp);
    await this.applyKeywords(conversation, event);
    await this.reapplyStatuses(workspaceId, event.externalMessageId);
    await this.events.publish('conversation.message_received', {
      workspaceId,
      conversationId: conversation.id,
      messageId: message.id,
    });
  }

  private async onStatus(connection: IntegrationConnection, event: StatusEvent): Promise<void> {
    const message = await this.prisma.scoped.message.findFirst({
      where: {
        externalId: event.externalMessageId,
        direction: 'OUTBOUND',
        conversation: { connectionId: connection.id },
      },
    });
    if (!message) {
      const inbound = await this.prisma.scoped.message.findFirst({
        where: {
          externalId: event.externalMessageId,
          conversation: { connectionId: connection.id },
        },
        select: { id: true },
      });
      if (inbound) return; // statuses of the customer's own messages mean nothing to us
      throw new MessageNotKnownError(event.externalMessageId);
    }
    if ((STATUS_RANK[event.status] ?? 0) <= (STATUS_RANK[message.status] ?? 0)) return;

    // compare-and-set: two statuses arriving together cannot move a message backwards
    const moved = await this.prisma.scoped.message.updateMany({
      where: { id: message.id, status: message.status },
      data: {
        status: event.status,
        failureReason: event.status === 'FAILED' ? (event.reason ?? 'Not delivered') : null,
      },
    });
    if (moved.count === 0) return this.onStatus(connection, event);
    await this.events.publish('conversation.message_status', {
      workspaceId: connection.workspaceId,
      conversationId: message.conversationId,
      messageId: message.id,
    });
  }

  private async onLeadForm(connection: IntegrationConnection, event: LeadFormEvent): Promise<void> {
    const fields = event.fields;
    const name =
      fields['full_name'] ??
      [fields['first_name'], fields['last_name']].filter(Boolean).join(' ').trim();
    const rawPhone = fields['phone_number'] ?? fields['phone'] ?? null;
    const phoneNormalized = rawPhone ? normalizePhone(rawPhone, await this.phones.country()) : null;
    const known = ['full_name', 'first_name', 'last_name', 'phone_number', 'phone', 'email'];
    const extra = Object.entries(fields)
      .filter(([key]) => !known.includes(key))
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    await this.leads.createFromChannel(connection.workspaceId, {
      fullName: name,
      phone: rawPhone,
      phoneNormalized,
      email: fields['email'] ?? null,
      source: 'AD_FORM',
      channel: connection.provider,
      campaign: event.campaign ?? null,
      adId: event.adId ?? null,
      formId: event.formId,
      requirements: extra || null,
    });
  }

  // ── conversation and identity ───────────────────────────────────────────────────────────

  /** The conversation with this contact on this connection, created (and linked to a person) on the first message. */
  private async conversationFor(
    connection: IntegrationConnection,
    event: MessageEvent,
  ): Promise<Conversation> {
    const where = {
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      externalContactId: event.externalContactId,
    };
    let conversation = await this.prisma.scoped.conversation.findFirst({ where });
    if (!conversation) {
      try {
        conversation = await this.prisma.scoped.conversation.create({
          data: {
            ...where,
            channelType: connection.provider,
            contactName: event.contactName ?? null,
            contactPhone: event.contactPhone ?? null,
          },
        });
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002')
          throw err;
        conversation = await this.prisma.scoped.conversation.findFirstOrThrow({ where });
      }
    }
    if (!conversation.customerId && !conversation.leadId) {
      const link = await this.identify(connection, event);
      conversation = await this.prisma.scoped.conversation.update({
        where: { id: conversation.id },
        data: {
          customerId: link.customerId,
          leadId: link.leadId,
          contactName: conversation.contactName ?? event.contactName ?? null,
        },
      });
    }
    return conversation;
  }

  /** A known customer by phone, else an open lead, else a new lead. */
  private async identify(
    connection: IntegrationConnection,
    event: MessageEvent,
  ): Promise<{ customerId: string | null; leadId: string | null }> {
    const phone = event.contactPhone
      ? normalizePhone(`+${event.contactPhone.replace(/^\+/, '')}`)
      : null;
    if (phone) {
      const customer = await this.prisma.scoped.customer.findFirst({
        where: { phonesNormalized: { has: phone }, mergedIntoId: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (customer) return { customerId: customer.id, leadId: null };
      const open = await this.leads.findOpenByPhone(phone);
      if (open) return { customerId: null, leadId: open.id };
    }
    const lead = await this.leads.createFromChannel(connection.workspaceId, {
      fullName: event.contactName ?? event.contactPhone ?? event.externalContactId,
      phone: event.contactPhone ? `+${event.contactPhone.replace(/^\+/, '')}` : null,
      phoneNormalized: phone,
      source: 'MESSAGING',
      channel: connection.provider,
    });
    return { customerId: null, leadId: lead.id };
  }

  private async touchConversation(conversation: Conversation, at: Date): Promise<void> {
    // never move the "last" times backwards when messages arrive out of order
    await this.prisma.scoped.conversation.updateMany({
      where: { id: conversation.id, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: at } }] },
      data: { lastMessageAt: at },
    });
    await this.prisma.scoped.conversation.updateMany({
      where: { id: conversation.id, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: at } }] },
      data: { lastInboundAt: at },
    });
    await this.prisma.scoped.conversation.update({
      where: { id: conversation.id },
      data: { unreadCount: { increment: 1 } },
    });
    await this.prisma.scoped.conversation.updateMany({
      where: { id: conversation.id, status: 'CLOSED' },
      data: { status: 'OPEN' },
    });
  }

  /** "STOP" and its kin withdraw consent to be messaged; "START" gives it back. */
  private async applyKeywords(conversation: Conversation, event: MessageEvent): Promise<void> {
    if (event.type !== 'TEXT' || !event.body) return;
    const word = event.body
      .trim()
      .replace(/[.!]+$/, '')
      .toUpperCase();
    const keywords = (await this.settings.get<string[] | undefined>(
      'messaging.optOutKeywords',
    )) ?? ['STOP', 'UNSUBSCRIBE'];
    const optOut = new Set(keywords.map((k) => k.trim().toUpperCase()));
    const status = optOut.has(word) ? 'OPTED_OUT' : OPT_IN.has(word) ? 'OPTED_IN' : null;
    if (!status) return;
    await this.prisma.scoped.contactConsent.upsert({
      where: {
        workspaceId_channelType_externalContactId: {
          workspaceId: conversation.workspaceId,
          channelType: conversation.channelType,
          externalContactId: conversation.externalContactId,
        },
      },
      create: {
        workspaceId: conversation.workspaceId,
        channelType: conversation.channelType,
        externalContactId: conversation.externalContactId,
        customerId: conversation.customerId,
        status,
        source: 'KEYWORD',
      },
      update: { status, source: 'KEYWORD', changedAt: new Date() },
    });
  }

  /** Photos and documents are kept in the workspace; a file that cannot be fetched or kept does not lose the message. */
  private async fetchMedia(
    connection: IntegrationConnection,
    event: MessageEvent,
  ): Promise<Array<{ fileId: string; name: string; mime: string }>> {
    if (!event.media || event.media.length === 0) return [];
    const adapter = this.channels.get(connection.provider);
    if (!adapter) return [];
    const kept: Array<{ fileId: string; name: string; mime: string }> = [];
    for (const media of event.media) {
      try {
        const secrets = this.integrations.secretsOf(connection);
        const file = await adapter.downloadMedia(secrets, media.ref);
        const stored = await this.files.storeSystemFile(connection.workspaceId, {
          buffer: file.body,
          ...(media.name ? { name: media.name } : {}),
        });
        if (stored) kept.push({ fileId: stored.id, name: stored.name, mime: stored.mime });
      } catch (err) {
        this.logger.warn({ err, connectionId: connection.id }, 'could not fetch inbound media');
      }
    }
    return kept;
  }

  // ── outcome ─────────────────────────────────────────────────────────────────────────────

  private async finish(id: string, status: 'PROCESSED' | 'IGNORED'): Promise<void> {
    await this.prisma.scoped.webhookEvent.update({
      where: { id },
      data: { status, processedAt: new Date(), error: null },
    });
  }

  private async failed(
    id: string,
    connection: IntegrationConnection,
    err: unknown,
    final: boolean,
  ): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err);
    await this.prisma.scoped.webhookEvent.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        error: reason.slice(0, 500),
        ...(final ? { status: 'FAILED' } : {}),
      },
    });
    if (!final) return;
    await this.prisma.scoped.integrationConnection.update({
      where: { id: connection.id },
      data: { lastErrorAt: new Date(), lastError: reason.slice(0, 500) },
    });
    await this.audit.recordAsync({
      action: 'webhook.failed',
      entityType: 'WebhookEvent',
      entityId: id,
      metadata: { provider: connection.provider, error: reason.slice(0, 200) },
      actor: { type: 'WEBHOOK', userId: null },
    });
    await this.events.publish('integration.failed', {
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
    });
  }
}

/** A stored event has its time as text; the code that handles it wants a date. */
function revive(payload: Prisma.JsonValue): NormalizedEvent {
  const event = payload as unknown as NormalizedEvent & { timestamp: string };
  return { ...event, timestamp: new Date(event.timestamp) } as NormalizedEvent;
}
