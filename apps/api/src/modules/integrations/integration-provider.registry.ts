import { Injectable } from '@nestjs/common';

export type IntegrationType = 'CHANNEL' | 'AI' | 'EMAIL' | 'STORAGE' | 'PAYMENT';

export interface ProviderField {
  key: string;
  label: string;
  /** Secret values are masked whenever they are read back. */
  secret: boolean;
  required: boolean;
}

export interface HealthResult {
  ok: boolean;
  /** A short, non-sensitive note such as the verified phone number. */
  detail?: string;
}

/** What the platform needs to know about a kind of connection; each adapter module registers its own. */
export interface ProviderDefinition {
  provider: string;
  type: IntegrationType;
  label: string;
  fields: readonly ProviderField[];
  /** The field whose value identifies the account at the provider (a phone number id, a page id). */
  accountIdField?: string;
  /** Calls the provider with these credentials. The platform wraps it in the AdapterRunner. */
  test(values: Record<string, string>): Promise<HealthResult>;
}

@Injectable()
export class IntegrationProviderRegistry {
  private readonly definitions = new Map<string, ProviderDefinition>();

  register(def: ProviderDefinition): void {
    this.definitions.set(def.provider, def);
  }

  get(provider: string): ProviderDefinition | undefined {
    return this.definitions.get(provider);
  }

  all(): ProviderDefinition[] {
    return [...this.definitions.values()];
  }
}
