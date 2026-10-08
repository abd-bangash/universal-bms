import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Logger } from 'pino';
import type { NormalizedEvent } from '@bms/types';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../../common/errors/app.exception';
import { LOGGER } from '../../../common/logging/app-logger';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ENV, type Env } from '../../../config/env';
import { AuditService } from '../../audit/audit.service';
import { QueueService } from '../../queue/queue.service';
import { ChannelRegistry } from '../channel.registry';

export interface IngestResult {
  /** Events newly stored. */
  accepted: number;
  /** Events seen before, or for an account nobody has connected. */
  ignored: number;
}

/**
 * The public side of the inbound pipeline (design.md "Inbound pipeline", steps 1 and 2). This is
 * the one place that resolves a workspace from a provider's account id, so it is the one place
 * allowed to read connections across workspaces. It stores each event durably, then queues it;
 * the work itself happens in `ChannelInboundService`, inside the workspace's context.
 */
@Injectable()
export class WebhookIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelRegistry,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Pick<Env, 'META_APP_SECRET' | 'META_WEBHOOK_VERIFY_TOKEN'>,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** The text to echo back to the provider's subscription check, or null when it must be refused. */
  challenge(provider: string, query: Record<string, string>): string {
    const adapter = this.channels.get(provider);
    if (!adapter) throw new NotFoundAppException();
    const answer = adapter.verifyChallenge(query, this.env.META_WEBHOOK_VERIFY_TOKEN);
    if (answer === null) throw new AppException('PERMISSION_DENIED', 403, 'Verification failed');
    return answer;
  }

  async receive(
    provider: string,
    rawBody: Buffer | undefined,
    headers: Record<string, string>,
  ): Promise<IngestResult> {
    const adapter = this.channels.get(provider);
    if (!adapter) throw new NotFoundAppException();

    const payload = parseJson(rawBody);
    const signed =
      rawBody !== undefined && adapter.verifySignature(rawBody, headers, this.env.META_APP_SECRET);
    if (!signed) {
      await this.signatureFailed(adapter.provider, payload);
      throw new AppException('UNAUTHENTICATED', 401, 'Invalid signature');
    }
    if (payload === undefined) {
      throw new ValidationFailedException({ body: ['must be valid JSON'] });
    }

    const result: IngestResult = { accepted: 0, ignored: 0 };
    for (const event of adapter.parseEvents(payload)) {
      if (await this.store(adapter.provider, event)) result.accepted += 1;
      else result.ignored += 1;
    }
    return result;
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────

  /** Stores one event and queues it. Returns false for a duplicate or an unknown account. */
  private async store(provider: string, event: NormalizedEvent): Promise<boolean> {
    const connection = await this.prisma.unscoped.integrationConnection.findFirst({
      where: {
        provider,
        externalAccountId: event.accountId,
        status: { not: 'DISCONNECTED' },
      },
      select: { id: true, workspaceId: true },
    });
    const data = {
      provider,
      dedupeKey: event.dedupeKey,
      workspaceId: connection?.workspaceId ?? null,
      connectionId: connection?.id ?? null,
      kind: event.kind,
      payload: JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue,
      status: connection ? 'RECEIVED' : 'IGNORED',
    };
    let id: string;
    try {
      id = (await this.prisma.unscoped.webhookEvent.create({ data, select: { id: true } })).id;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      // delivered before. If it was stored but never queued (a crash between the two steps), queue it now.
      const existing = await this.prisma.unscoped.webhookEvent.findUnique({
        where: { provider_dedupeKey: { provider, dedupeKey: event.dedupeKey } },
      });
      if (
        existing &&
        existing.status === 'RECEIVED' &&
        existing.workspaceId &&
        existing.attempts === 0
      ) {
        await this.enqueue(existing.workspaceId, existing.id);
      }
      return false;
    }
    if (!connection) return false;
    await this.enqueue(connection.workspaceId, id);
    return true;
  }

  private async enqueue(workspaceId: string, webhookEventId: string): Promise<void> {
    try {
      await this.queues.add('channel.inbound', 'process', { workspaceId, webhookEventId });
    } catch (err) {
      // The event is stored; a redelivery or the failed-webhook sweep picks it up. The provider must still get its 200.
      this.logger.error({ err, webhookEventId }, 'could not queue a stored webhook event');
    }
  }

  /** A request that is not signed by the provider is refused and recorded against the workspace it claims to be for. */
  private async signatureFailed(provider: string, payload: unknown): Promise<void> {
    const adapter = this.channels.get(provider);
    let workspaceId: string | undefined;
    try {
      const accountIds = payload === undefined ? [] : (adapter?.extractAccountIds(payload) ?? []);
      if (accountIds.length > 0) {
        const connection = await this.prisma.unscoped.integrationConnection.findFirst({
          where: { provider, externalAccountId: { in: accountIds } },
          select: { workspaceId: true },
        });
        workspaceId = connection?.workspaceId;
      }
    } catch {
      // an unreadable payload is simply not attributed to any workspace
    }
    this.logger.warn({ provider, workspaceId }, 'webhook rejected: invalid signature');
    if (workspaceId) {
      await this.audit.recordAsync({
        action: 'webhook.signature_failed',
        entityType: 'Webhook',
        entityId: provider,
        workspaceId,
        metadata: { provider },
        actor: { type: 'WEBHOOK', userId: null },
      });
    }
  }
}

function parseJson(raw: Buffer | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return undefined;
  }
}
