import type { DomainEventName } from '@bms/types';
import type { DomainEventBus, DomainEventInput } from './domain-event-bus';

interface Queued {
  name: DomainEventName;
  input: DomainEventInput<DomainEventName>;
}

/**
 * Holds events raised inside a database transaction. `flush` publishes them once the transaction
 * has committed; `discard` drops them when it rolled back, so listeners never see an event for a
 * change that did not happen.
 */
export class DomainEventCollector {
  private queue: Queued[] = [];

  add<N extends DomainEventName>(name: N, input: DomainEventInput<N>): void {
    this.queue.push({ name, input: input as DomainEventInput<DomainEventName> });
  }

  get size(): number {
    return this.queue.length;
  }

  async flush(bus: DomainEventBus): Promise<void> {
    const events = this.queue;
    this.queue = [];
    for (const { name, input } of events) await bus.publish(name, input);
  }

  discard(): void {
    this.queue = [];
  }
}
