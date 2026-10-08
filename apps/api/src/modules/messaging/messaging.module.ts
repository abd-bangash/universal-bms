import { Module, type OnModuleInit } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SearchService } from '../search/search.service';
import { conversationSearch } from './messaging-search';
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
    private readonly search: SearchService,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  onModuleInit(): void {
    this.search.register(conversationSearch(this.prisma, this.cls));
    this.queues.register<{ workspaceId: string; messageId: string }>({
      queue: 'channel.outbound',
      attempts: OUTBOUND_ATTEMPTS,
      backoffMs: OUTBOUND_BACKOFF_MS,
      handler: (payload, job) => this.conversations.deliver(payload.messageId, job),
    });
  }
}
