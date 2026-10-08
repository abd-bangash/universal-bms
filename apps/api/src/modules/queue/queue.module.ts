import { Global, Module } from '@nestjs/common';
import { QueueRegistry } from './queue.registry';
import { QueueService } from './queue.service';

/** Redis-backed job queues with a dead-letter queue (task 68). */
@Global()
@Module({
  providers: [QueueRegistry, QueueService],
  exports: [QueueRegistry, QueueService],
})
export class QueueModule {}
