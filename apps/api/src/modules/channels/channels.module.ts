import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { QueueRegistry } from '../queue/queue.registry';
import { IntegrationProviderRegistry } from '../integrations/integration-provider.registry';
import { ChannelRegistry } from './channel.registry';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import { WebhooksController } from './webhooks.controller';
import { WebhookIngestService } from './webhook-workspace/webhook-ingest.service';
import {
  ChannelInboundService,
  INBOUND_ATTEMPTS,
  INBOUND_BACKOFF_MS,
} from './channel-inbound.service';

/** Channel adapters and the registry the webhook and sending code use to find them (tasks 71 to 73). */
@Global()
@Module({
  imports: [CrmModule],
  controllers: [WebhooksController],
  providers: [
    ChannelRegistry,
    WebhookIngestService,
    ChannelInboundService,
    { provide: WhatsAppAdapter, useFactory: () => new WhatsAppAdapter() },
  ],
  exports: [ChannelRegistry, WhatsAppAdapter, ChannelInboundService],
})
export class ChannelsModule implements OnModuleInit {
  constructor(
    private readonly channels: ChannelRegistry,
    private readonly providers: IntegrationProviderRegistry,
    private readonly whatsapp: WhatsAppAdapter,
    private readonly queues: QueueRegistry,
    private readonly inbound: ChannelInboundService,
  ) {}

  onModuleInit(): void {
    this.channels.register(this.whatsapp);
    this.queues.register({
      queue: 'channel.inbound',
      attempts: INBOUND_ATTEMPTS,
      backoffMs: INBOUND_BACKOFF_MS,
      handler: (payload, job) => this.inbound.process(payload as never, job),
    });
    this.providers.register({
      provider: 'WHATSAPP',
      type: 'CHANNEL',
      label: 'WhatsApp Business',
      accountIdField: 'phoneNumberId',
      fields: [
        { key: 'phoneNumberId', label: 'Phone number ID', secret: false, required: true },
        { key: 'wabaId', label: 'WhatsApp Business account ID', secret: false, required: false },
        { key: 'accessToken', label: 'Access token', secret: true, required: true },
      ],
      test: (values) => this.whatsapp.testConnection(values),
    });
  }
}
