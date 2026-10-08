import { Injectable } from '@nestjs/common';
import type { DomainEventPayload } from '@bms/types';
import { OnDomainEvent } from '../../common/events/on-domain-event.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TasksService } from './tasks.service';

@Injectable()
export class TaskListener {
  constructor(
    private readonly tasks: TasksService,
    private readonly prisma: PrismaService,
  ) {}

  /** A lead that has been won or lost needs no more follow-up reminders. */
  @OnDomainEvent('lead.status_changed')
  async onLeadStatusChanged(event: DomainEventPayload<'lead.status_changed'>): Promise<void> {
    const lead = await this.prisma.scoped.lead.findFirst({ where: { id: event.leadId } });
    if (lead?.closedAt) await this.tasks.cancelLeadFollowUp(lead.id);
  }
}
