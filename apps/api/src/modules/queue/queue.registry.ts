import { Injectable } from '@nestjs/common';
import type { JobPayload, ProcessorDefinition, QueueName } from './queue.types';

/** Modules register what handles each queue when they start; the service runs it. */
@Injectable()
export class QueueRegistry {
  private readonly processors = new Map<QueueName, ProcessorDefinition>();

  register<P extends JobPayload>(def: ProcessorDefinition<P>): void {
    if (this.processors.has(def.queue))
      throw new Error(`Queue ${def.queue} already has a processor`);
    this.processors.set(def.queue, def as unknown as ProcessorDefinition);
  }

  get(queue: QueueName): ProcessorDefinition | undefined {
    return this.processors.get(queue);
  }

  all(): ProcessorDefinition[] {
    return [...this.processors.values()];
  }
}
