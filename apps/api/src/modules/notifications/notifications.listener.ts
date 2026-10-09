import { Injectable } from '@nestjs/common';
import type { DomainEventPayload } from '@bms/types';
import { OnDomainEvent } from '../../common/events/on-domain-event.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from './notifications.service';

const preview = (text: string | null, type: string): string =>
  (text?.trim() ? text.trim() : `[${type.toLowerCase()}]`).slice(0, 140);

/**
 * Turns domain events into notifications (Requirement 33.2). The recipient is the person the record
 * belongs to; when it belongs to nobody, everyone whose role holds the permission the event is about
 * (Requirement 33.3). Release 1 is in-app only, with every type on for everyone.
 */
@Injectable()
export class NotificationsListener {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  @OnDomainEvent('lead.assigned')
  async onLeadAssigned(event: DomainEventPayload<'lead.assigned'>): Promise<void> {
    if (!event.assignedToId || event.assignedToId === event.actorUserId) return; // nobody tells you about your own doing
    const lead = await this.prisma.scoped.lead.findFirst({ where: { id: event.leadId } });
    if (!lead) return;
    await this.notifications.notify([event.assignedToId], {
      type: 'lead.assigned',
      title: `Lead assigned to you: ${lead.fullName}`,
      body: lead.interest,
      entityType: 'Lead',
      entityId: lead.id,
    });
  }

  @OnDomainEvent('conversation.message_received')
  async onMessage(event: DomainEventPayload<'conversation.message_received'>): Promise<void> {
    const conversation = await this.prisma.scoped.conversation.findFirst({
      where: { id: event.conversationId },
      include: { lead: { select: { assignedToId: true } } },
    });
    const message = await this.prisma.scoped.message.findFirst({ where: { id: event.messageId } });
    if (!conversation || !message) return;
    const name = conversation.contactName ?? conversation.contactPhone ?? 'a customer';
    const assignee = conversation.assignedToId ?? conversation.lead?.assignedToId ?? null;
    let recipients: string[];
    if (assignee) recipients = [assignee];
    else if (
      (await this.prisma.scoped.message.count({ where: { conversationId: conversation.id } })) === 1
    ) {
      // a conversation nobody has yet: tell the people who hand them out, once, when it begins
      recipients = await this.notifications.holdersOf('conversation:assign');
    } else return;
    await this.notifications.notify(recipients, {
      type: 'conversation.message',
      title: `New message from ${name}`,
      body: preview(message.body, message.type),
      entityType: 'Conversation',
      entityId: conversation.id,
    });
  }

  @OnDomainEvent('task.due')
  async onTaskDue(event: DomainEventPayload<'task.due'>): Promise<void> {
    const task = await this.prisma.scoped.task.findFirst({ where: { id: event.taskId } });
    if (!task) return;
    const recipients = task.assignedToId
      ? [task.assignedToId]
      : await this.notifications.holdersOf('task:view_all');
    await this.notifications.notify(recipients, {
      type: 'task.due',
      title: `Task due: ${task.title}`,
      entityType: 'Task',
      entityId: task.id,
    });
  }

  @OnDomainEvent('stock.low')
  async onStockLow(event: DomainEventPayload<'stock.low'>): Promise<void> {
    const [variant, location] = await Promise.all([
      this.prisma.scoped.productVariant.findFirst({
        where: { id: event.variantId },
        include: { product: { select: { name: true } } },
      }),
      this.prisma.scoped.inventoryLocation.findFirst({ where: { id: event.locationId } }),
    ]);
    if (!variant) return;
    await this.notifications.notify(await this.notifications.holdersOf('inventory:adjust'), {
      type: 'stock.low',
      title: `Low stock: ${variant.product.name} (${variant.sku})`,
      body: location ? `At ${location.name}` : null,
      entityType: 'ProductVariant',
      entityId: variant.id,
    });
  }

  @OnDomainEvent('ai.escalated')
  async onAiEscalated(event: DomainEventPayload<'ai.escalated'>): Promise<void> {
    const conversation = await this.prisma.scoped.conversation.findFirst({
      where: { id: event.conversationId },
      include: { lead: { select: { assignedToId: true } } },
    });
    if (!conversation) return;
    const assignee = conversation.assignedToId ?? conversation.lead?.assignedToId ?? null;
    const recipients = assignee
      ? [assignee]
      : await this.notifications.holdersOf('conversation:assign');
    await this.notifications.notify(recipients, {
      type: 'ai.escalated',
      title: `A conversation needs a person: ${conversation.contactName ?? conversation.contactPhone ?? 'a customer'}`,
      body: conversation.needsHumanReason,
      entityType: 'Conversation',
      entityId: conversation.id,
    });
  }

  @OnDomainEvent('integration.failed')
  async onIntegrationFailed(event: DomainEventPayload<'integration.failed'>): Promise<void> {
    const connection = await this.prisma.scoped.integrationConnection.findFirst({
      where: { id: event.connectionId },
    });
    if (!connection) return;
    await this.notifications.notify(await this.notifications.holdersOf('integration:manage'), {
      type: 'integration.failed',
      title: `${connection.displayName ?? connection.provider} has a problem`,
      body: connection.lastError,
      entityType: 'IntegrationConnection',
      entityId: connection.id,
    });
  }
}
