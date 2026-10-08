import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { Logger } from 'pino';
import type { RequestContext } from '../../common/context/request-context';
import { LOGGER } from '../../common/logging/app-logger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { computeStateChange, toJsonSafe, type JsonValue } from './audit-diff';

export type ActorType = 'USER' | 'SYSTEM' | 'AUTOMATION' | 'AI' | 'WEBHOOK';

export interface AuditInput {
  /** Dotted name such as `order.create`, `payment.void`, `auth.login_failed`. */
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  /** Defaults to the user in the request context. */
  actor?: { type?: ActorType; userId?: string | null; role?: string | null };
}

/** The part of a transaction client that `record` needs; satisfied by every Prisma transaction. */
export interface AuditTx {
  auditEvent: {
    create(args: { data: Prisma.AuditEventUncheckedCreateInput }): PromiseLike<unknown>;
  };
}

const RETRY_DELAYS_MS = [100, 400, 1600] as const;

@Injectable()
export class AuditService {
  /** Replaced in tests so retries do not wait. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    private readonly cls: ClsService<RequestContext>,
    private readonly prisma: PrismaService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Writes the Audit_Event inside the caller's transaction, so a change cannot commit without its
   * event and a rolled-back change leaves none (design D9).
   */
  async record(tx: AuditTx, input: AuditInput): Promise<void> {
    const workspaceId = this.cls.get('workspaceId');
    if (!workspaceId) throw new Error('AuditService.record needs a workspace in context');
    await tx.auditEvent.create({ data: this.build(workspaceId, input) });
  }

  /**
   * For events with no surrounding transaction (failed login, webhook signature failure, adapter
   * error). Retries three times, then logs at error level with an alert tag. Never throws.
   * `workspaceId` is needed only when no workspace is in context.
   */
  async recordAsync(input: AuditInput & { workspaceId?: string }): Promise<void> {
    const workspaceId = input.workspaceId ?? this.cls.get('workspaceId');
    if (!workspaceId) {
      this.logger.error(
        { alert: 'audit_write_failed', action: input.action, reason: 'no workspace' },
        'audit event could not be stored',
      );
      return;
    }
    const data = this.build(workspaceId, input);
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        // Prisma queries are lazy: they must be awaited inside the context callback.
        await this.cls.runWith({ ...this.snapshotContext(), workspaceId }, async () => {
          await this.prisma.scoped.auditEvent.create({ data });
        });
        return;
      } catch (err) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          this.logger.error(
            { err, alert: 'audit_write_failed', action: input.action, workspaceId },
            'audit event could not be stored after retries',
          );
          return;
        }
        await this.sleep(delay);
      }
    }
  }

  private snapshotContext(): RequestContext {
    return {
      userId: this.cls.get('userId'),
      requestId: this.cls.get('requestId'),
      ip: this.cls.get('ip'),
      userAgent: this.cls.get('userAgent'),
      actorRole: this.cls.get('actorRole'),
    };
  }

  private build(workspaceId: string, input: AuditInput): Prisma.AuditEventUncheckedCreateInput {
    const { previousState, newState } = computeStateChange(input.before, input.after);
    const actorType = input.actor?.type ?? 'USER';
    return {
      workspaceId,
      actorUserId:
        input.actor && 'userId' in input.actor
          ? (input.actor.userId ?? null)
          : (this.cls.get('userId') ?? null),
      actorType,
      actorRole: input.actor?.role ?? this.cls.get('actorRole') ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      previousState: previousState === null ? undefined : (previousState as Prisma.InputJsonValue),
      newState: newState === null ? undefined : (newState as Prisma.InputJsonValue),
      metadata: input.metadata ? (toJsonSafe(input.metadata) as Prisma.InputJsonValue) : undefined,
      ipAddress: this.cls.get('ip') ?? null,
      userAgent: this.cls.get('userAgent') ?? null,
      requestId: this.cls.get('requestId') ?? null,
    };
  }
}

export type { JsonValue };
