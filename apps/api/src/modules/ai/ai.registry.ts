import { Injectable } from '@nestjs/common';
import type { AIAdapter, IntegrationSecrets } from '@bms/types';
import { AppException } from '../../common/errors/app.exception';
import { IntegrationsService } from '../integrations/integrations.service';
import { SettingsService } from '../settings/settings.service';

/** Builds a provider's adapter from the credentials a workspace stored for it. */
export interface AIProviderFactory {
  readonly provider: string;
  create(secrets: IntegrationSecrets): AIAdapter;
}

/**
 * Finds the AI adapter for the workspace in context: the provider the workspace chose, with the
 * key it stored through the integrations screen. Adding a provider is a factory and a provider
 * definition; nothing that uses AI changes (Requirement 24.3).
 */
@Injectable()
export class AIRegistry {
  private readonly factories = new Map<string, AIProviderFactory>();
  private override: AIAdapter | null = null;

  constructor(
    private readonly settings: SettingsService,
    private readonly integrations: IntegrationsService,
  ) {}

  register(factory: AIProviderFactory): void {
    this.factories.set(factory.provider, factory);
  }

  providers(): string[] {
    return [...this.factories.keys()];
  }

  /** Tests use this to answer for the provider; `null` goes back to the real one. */
  useAdapter(adapter: AIAdapter | null): void {
    this.override = adapter;
  }

  /** The adapter for the current workspace, or an AI_UNAVAILABLE error saying what is missing. */
  async adapter(): Promise<AIAdapter> {
    if (this.override) return this.override;
    const provider = await this.settings.get<string | undefined>('ai.provider');
    if (!provider) throw this.unavailable('No AI provider has been chosen');
    const factory = this.factories.get(provider);
    if (!factory) throw this.unavailable('The chosen AI provider is not available');
    const stored = await this.integrations.secretsFor(provider);
    if (!stored) throw this.unavailable('The AI provider is not connected');
    const model = await this.settings.get<string | undefined>('ai.model');
    return factory.create({ ...(model ? { model } : {}), ...stored.values });
  }

  private unavailable(message: string): AppException {
    return new AppException('AI_UNAVAILABLE', 503, message);
  }
}
