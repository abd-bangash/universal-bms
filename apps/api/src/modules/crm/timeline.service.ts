import { Injectable } from '@nestjs/common';
import type { TimelineEntry } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import { NotFoundAppException } from '../../common/errors/app.exception';
import {
  keysetCursor,
  keysetWhere,
  toPage,
  DEFAULT_PAGE_LIMIT,
  type Page,
} from '../../common/pagination/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface TimelineEntryDto {
  id: string;
  type: string;
  refType: string | null;
  refId: string | null;
  summary: string;
  actorUserId: string | null;
  occurredAt: string;
}

export interface TimelineInput {
  customerId?: string | null;
  leadId?: string | null;
  orderId?: string | null;
  type:
    'MESSAGE' | 'NOTE' | 'CALL' | 'TASK' | 'QUOTATION' | 'ORDER' | 'PAYMENT' | 'STATUS' | 'SYSTEM';
  refType?: string;
  refId?: string;
  summary: string;
  actorUserId?: string | null;
  occurredAt?: Date;
}

const toDto = (e: TimelineEntry): TimelineEntryDto => ({
  id: e.id,
  type: e.type,
  refType: e.refType,
  refId: e.refId,
  summary: e.summary,
  actorUserId: e.actorUserId,
  occurredAt: e.occurredAt.toISOString(),
});

/**
 * The chronological record on a customer or lead: messages, orders, payments, notes and status
 * changes (Requirement 8.4). Modules add entries as they act; listeners add them for Domain_Events.
 */
@Injectable()
export class TimelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  /** Adds an entry for the workspace in context (the request or the event being handled). */
  async record(input: TimelineInput): Promise<void> {
    const workspaceId = this.cls.get('workspaceId');
    if (!workspaceId) throw new Error('No workspace in context');
    await this.prisma.scoped.timelineEntry.create({
      data: {
        workspaceId,
        customerId: input.customerId ?? null,
        leadId: input.leadId ?? null,
        orderId: input.orderId ?? null,
        type: input.type,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        summary: input.summary,
        actorUserId: input.actorUserId ?? this.cls.get('userId') ?? null,
        occurredAt: input.occurredAt ?? new Date(),
      },
    });
  }

  /** Newest first; for a customer it includes the entries of that customer's leads. */
  async listFor(
    subject: { customerId: string } | { leadId: string } | { orderId: string },
    query: { limit?: number; cursor?: string },
  ): Promise<Page<TimelineEntryDto>> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    let scope: Record<string, unknown>;
    if ('customerId' in subject) {
      const leads = await this.prisma.scoped.lead.findMany({
        where: { customerId: subject.customerId },
        select: { id: true },
      });
      scope = {
        OR: [{ customerId: subject.customerId }, { leadId: { in: leads.map((l) => l.id) } }],
      };
    } else if ('orderId' in subject) {
      scope = { orderId: subject.orderId };
    } else {
      scope = { leadId: subject.leadId };
    }
    const after = keysetWhere('occurredAt', 'desc', query.cursor, true);
    const rows = await this.prisma.scoped.timelineEntry.findMany({
      where: { AND: [scope, ...(after ? [after] : [])] },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toPage(rows, limit, (last) => keysetCursor(last.occurredAt, last.id)).map(toDto);
  }

  async assertCustomer(customerId: string): Promise<void> {
    if (
      !(await this.prisma.scoped.customer.findFirst({ where: { id: customerId, isWalkIn: false } }))
    )
      throw new NotFoundAppException();
  }
}
