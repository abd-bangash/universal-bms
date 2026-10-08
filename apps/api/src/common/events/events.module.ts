import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DomainEventBus } from './domain-event-bus';
import { InProcessDomainEventBus } from './in-process-domain-event-bus';

@Global()
@Module({
  imports: [EventEmitterModule.forRoot({ wildcard: false, ignoreErrors: false })],
  providers: [{ provide: DomainEventBus, useClass: InProcessDomainEventBus }],
  exports: [DomainEventBus],
})
export class EventsModule {}
