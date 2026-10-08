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
