import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { IntegrationProviderRegistry } from '../integrations/integration-provider.registry';
import { AIRegistry } from './ai.registry';
import { ANTHROPIC_PROVIDER, AnthropicAdapter } from './anthropic.adapter';

/** AI providers and the registry that finds the one a workspace uses (task 76). The AI service is task 77. */
@Global()
@Module({
  providers: [AIRegistry],
  exports: [AIRegistry],
})
export class AiModule implements OnModuleInit {
  constructor(
    private readonly registry: AIRegistry,
    private readonly providers: IntegrationProviderRegistry,
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
  }
}
