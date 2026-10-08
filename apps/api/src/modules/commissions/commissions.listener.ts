import { Injectable } from '@nestjs/common';
import type { DomainEventPayload } from '@bms/types';
import { OnDomainEvent } from '../../common/events/on-domain-event.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { SettingsService } from '../settings/settings.service';
import { CommissionsService } from './commissions.service';

/**
 * Commissions are worked out when an order reaches the configured System_Role (Requirement 14.2),
 * and straight away for a counter sale, which is born completed. The work itself is done by the queue's processor.
 */
@Injectable()
export class CommissionsListener {
  constructor(
    private readonly commissions: CommissionsService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly queues: QueueService,
  ) {}

  @OnDomainEvent('order.created')
  async onOrderCreated(event: DomainEventPayload<'order.created'>): Promise<void> {
    const order = await this.prisma.scoped.order.findFirst({
      where: { id: event.orderId },
      select: { source: true },
    });
    if (order?.source === 'POS') await this.enqueue(event);
  }

  @OnDomainEvent('order.status_changed')
  async onOrderStatusChanged(event: DomainEventPayload<'order.status_changed'>): Promise<void> {
    const order = await this.prisma.scoped.order.findFirst({
      where: { id: event.orderId },
      select: { status: true },
    });
    if (!order) return;
    const trigger = await this.settings.get<string>('commission.triggerSystemRole');
    const state = await this.prisma.scoped.workflowState.findFirst({
      where: { key: order.status, workflow: { entityType: 'ORDER' } },
      select: { systemRole: true },
    });
    if (state?.systemRole === trigger) await this.enqueue(event);
  }

  /** The calculation runs on the `commission.calculate` queue, with retries; the listener only asks for it. */
  private enqueue(event: { workspaceId: string; orderId: string; actorUserId: string | null }) {
    return this.queues.add('commission.calculate', 'calculate', {
      workspaceId: event.workspaceId,
      orderId: event.orderId,
      actorUserId: event.actorUserId,
    });
  }
}
