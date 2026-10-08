import type {
  DomainEventBase,
  DomainEventMap,
  DomainEventName,
  DomainEventPayload,
} from '@bms/types';

/** What a caller supplies; `occurredAt` and the actor default from the request context. */
export type DomainEventInput<N extends DomainEventName> = DomainEventMap[N] &
  Pick<DomainEventBase, 'workspaceId'> &
  Partial<Pick<DomainEventBase, 'actorUserId' | 'occurredAt'>>;

/**
 * Publish side of the event bus. Modules depend on this class, never on an implementation:
 * R1 is in-process (InProcessDomainEventBus); R2 swaps in a transactional outbox with no change
 * to callers (design.md D14).
 *
 * Call `publish` only after the transaction that caused the event has committed. Inside a
 * transaction, queue events on a DomainEventCollector and flush it after commit.
 */
export abstract class DomainEventBus {
  abstract publish<N extends DomainEventName>(name: N, input: DomainEventInput<N>): Promise<void>;
}

export type { DomainEventPayload };
