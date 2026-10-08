import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEventName } from '@bms/types';

/** Marks a method as a listener of one Domain_Event. Receives DomainEventPayload<N>. */
export const OnDomainEvent = (name: DomainEventName): MethodDecorator =>
  OnEvent(name, { async: false });
