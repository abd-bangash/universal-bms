import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CrmModule } from '../crm/crm.module';
import { IntegrationProviderRegistry } from '../integrations/integration-provider.registry';
import { MessagingModule } from '../messaging/messaging.module';
import { QueueRegistry } from '../queue/queue.registry';
import { AiAssistListener } from './ai-assist.listener';
import { AiController } from './ai.controller';
import { AIRegistry } from './ai.registry';
import { AiService } from './ai.service';
import { ANTHROPIC_PROVIDER, AnthropicAdapter } from './anthropic.adapter';
import { ContextBuilder } from './context-builder';
import { KnowledgeService } from './knowledge.service';

/** AI providers, the registry that finds the one a workspace uses, and the service that uses it (tasks 76 and 77). */
@Global()
@Module({
  imports: [CrmModule, MessagingModule],
  controllers: [AiController],
  providers: [AIRegistry, AiService, ContextBuilder, KnowledgeService, AiAssistListener],
  exports: [AIRegistry, AiService],
})
export class AiModule implements OnModuleInit {
  constructor(
    private readonly registry: AIRegistry,
    private readonly providers: IntegrationProviderRegistry,
    private readonly queues: QueueRegistry,
    private readonly ai: AiService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      provider: ANTHROPIC_PROVIDER,
      create: (secrets) => new AnthropicAdapter(secrets),
    });
    this.providers.register({
      provider: ANTHROPIC_PROVIDER,
      type: 'AI',
      label: 'Anthropic (Claude)',
      fields: [
        { key: 'apiKey', label: 'API key', secret: true, required: true },
        { key: 'model', label: 'Model (optional)', secret: false, required: false },
      ],
      test: (values) => new AnthropicAdapter(values).testConnection(),
    });
    this.queues.register<{ workspaceId: string; conversationId: string; messageId: string }>({
      queue: 'ai.process',
      attempts: 1, // a failed AI call is logged and flagged, not retried: staff can run it again
      handler: async (payload) => {
        // only the latest message of a burst starts the assistant
        const latest = await this.prisma.scoped.message.findFirst({
          where: { conversationId: payload.conversationId, direction: 'INBOUND' },
          orderBy: [{ providerTimestamp: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        if (latest?.id !== payload.messageId) return;
        await this.ai.assist(payload.conversationId);
      },
    });
  }
}
