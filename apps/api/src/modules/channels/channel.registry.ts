import { Injectable } from '@nestjs/common';
import type { ChannelAdapter, ChannelProvider } from '@bms/types';

/** The channel adapters that are installed; the webhook controller and the senders look them up by provider name. */
@Injectable()
export class ChannelRegistry {
  private readonly adapters = new Map<string, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  /** The adapter for a provider name taken from a URL: unknown names give undefined, never a throw. */
  get(provider: string): ChannelAdapter | undefined {
    return this.adapters.get(provider.toUpperCase());
  }

  require(provider: ChannelProvider): ChannelAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new Error(`No adapter is installed for ${provider}`);
    return adapter;
  }

  all(): ChannelAdapter[] {
    return [...this.adapters.values()];
  }
}
