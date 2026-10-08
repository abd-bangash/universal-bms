import { Injectable } from '@nestjs/common';
import type { DomainEventPayload } from '@bms/types';
import { OnDomainEvent } from '../../common/events/on-domain-event.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TimelineService } from './timeline.service';

/** Turns Domain_Events into timeline entries. Later modules add the handlers for their own events. */
@Injectable()
export class TimelineListener {
  constructor(
    private readonly timeline: TimelineService,
    private readonly prisma: PrismaService,
  ) {}

  @OnDomainEvent('customer.created')
  async onCustomerCreated(event: DomainEventPayload<'customer.created'>): Promise<void> {
    await this.timeline.record({
      customerId: event.customerId,
      type: 'SYSTEM',
      refType: 'Customer',
      refId: event.customerId,
      summary: 'Customer record created',
      actorUserId: event.actorUserId,
      occurredAt: new Date(event.occurredAt),
    });
  }

  /** Every stage change, whoever caused it, becomes a line on the lead's timeline (Requirement 9.3). */
  @OnDomainEvent('lead.status_changed')
  async onLeadStatusChanged(event: DomainEventPayload<'lead.status_changed'>): Promise<void> {
    const change = await this.prisma.scoped.statusHistory.findFirst({
      where: { entityType: 'LEAD', entityId: event.leadId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!change) return;
    const states = await this.prisma.scoped.workflowState.findMany({
      where: {
        workflow: { entityType: 'LEAD' },
        key: { in: [change.fromKey ?? '', change.toKey] },
      },
    });
    const label = (key: string | null) => states.find((s) => s.key === key)?.label ?? key ?? '—';
    await this.timeline.record({
      leadId: event.leadId,
      type: 'STATUS',
      refType: 'StatusHistory',
      refId: change.id,
      summary: `Stage changed from ${label(change.fromKey)} to ${label(change.toKey)}${change.note ? `: ${change.note}` : ''}`,
      actorUserId: event.actorUserId,
      occurredAt: new Date(event.occurredAt),
    });
  }

  @OnDomainEvent('customer.merged')
  async onCustomerMerged(event: DomainEventPayload<'customer.merged'>): Promise<void> {
    await this.timeline.record({
      customerId: event.survivorId,
      type: 'SYSTEM',
      refType: 'Customer',
      refId: event.mergedId,
      summary: 'Another customer record was merged into this one',
      actorUserId: event.actorUserId,
      occurredAt: new Date(event.occurredAt),
    });
  }
}
