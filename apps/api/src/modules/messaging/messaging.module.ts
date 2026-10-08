import { Module, type OnModuleInit } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { QueueRegistry } from '../queue/queue.registry';
import { ConversationsController } from './conversations.controller';
import {
  ConversationsService,
  OUTBOUND_ATTEMPTS,
  OUTBOUND_BACKOFF_MS,
} from './conversations.service';
import { TemplateContextService } from './template-context.service';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/** Conversations, sending and templates (task 73). Receiving is the channels module. */
@Module({
  imports: [DocumentsModule],
  controllers: [ConversationsController, TemplatesController],
  providers: [ConversationsService, TemplatesService, TemplateContextService],
  exports: [ConversationsService, TemplatesService],
})
export class MessagingModule implements OnModuleInit {
  constructor(
    private readonly queues: QueueRegistry,
    private readonly conversations: ConversationsService,
  ) {}

  onModuleInit(): void {
    this.queues.register<{ workspaceId: string; messageId: string }>({
      queue: 'channel.outbound',
      attempts: OUTBOUND_ATTEMPTS,
      backoffMs: OUTBOUND_BACKOFF_MS,
      handler: (payload, job) => this.conversations.deliver(payload.messageId, job),
    });
  }
}
