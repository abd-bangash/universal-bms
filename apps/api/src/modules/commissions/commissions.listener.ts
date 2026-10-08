import { Injectable } from '@nestjs/common';
import type { DomainEventPayload } from '@bms/types';
import { OnDomainEvent } from '../../common/events/on-domain-event.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CommissionsService } from './commissions.service';

/**
 * Commissions are worked out when an order reaches the configured System_Role (Requirement 14.2),
 * and straight away for a counter sale, which is born completed. Task 68 moves this onto a queue.
 */
@Injectable()
export class CommissionsListener {
  constructor(
    private readonly commissions: CommissionsService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @OnDomainEvent('order.created')
  async onOrderCreated(event: DomainEventPayload<'order.created'>): Promise<void> {
    const order = await this.prisma.scoped.order.findFirst({
      where: { id: event.orderId },
      select: { source: true },
    });
    if (order?.source === 'POS') await this.commissions.calculateForOrder(event.orderId);
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
    if (state?.systemRole === trigger) await this.commissions.calculateForOrder(event.orderId);
  }
}
