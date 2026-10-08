import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { IntegrationProviderRegistry } from '../integrations/integration-provider.registry';
import { ChannelRegistry } from './channel.registry';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';

/** Channel adapters and the registry the webhook and sending code use to find them (tasks 71 to 73). */
@Global()
@Module({
  providers: [
    ChannelRegistry,
    { provide: WhatsAppAdapter, useFactory: () => new WhatsAppAdapter() },
  ],
  exports: [ChannelRegistry, WhatsAppAdapter],
})
export class ChannelsModule implements OnModuleInit {
  constructor(
    private readonly channels: ChannelRegistry,
    private readonly providers: IntegrationProviderRegistry,
    private readonly whatsapp: WhatsAppAdapter,
  ) {}

  onModuleInit(): void {
    this.channels.register(this.whatsapp);
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
