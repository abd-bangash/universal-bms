import { Injectable } from '@nestjs/common';
import type { DomainEventPayload } from '@bms/types';
import { OnDomainEvent } from '../../common/events/on-domain-event.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { SettingsService } from '../settings/settings.service';

/** In ASSIST mode the assistant starts this long after the customer's last message, so a burst of messages is read once. */
export const ASSIST_DEBOUNCE_MS = 20_000;

@Injectable()
export class AiAssistListener {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly queues: QueueService,
  ) {}

  /**
   * Queues the automatic step for the message just received. Each message queues its own job; the
   * job runs only if its message is still the latest, so the last message of a burst wins.
   */
  @OnDomainEvent('conversation.message_received')
  async onMessage(event: DomainEventPayload<'conversation.message_received'>): Promise<void> {
    const mode = await this.settings.get<string>('ai.mode');
    if (mode === 'OFF' || mode === undefined) return;
    const conversation = await this.prisma.scoped.conversation.findFirst({
      where: { id: event.conversationId },
      select: { aiEnabled: true },
    });
    if (!conversation?.aiEnabled) return;
    await this.queues.add(
      'ai.process',
      'assist',
      {
        workspaceId: event.workspaceId,
        conversationId: event.conversationId,
        messageId: event.messageId,
      },
      { jobId: `assist-${event.messageId}`, delayMs: ASSIST_DEBOUNCE_MS },
    );
  }
}
