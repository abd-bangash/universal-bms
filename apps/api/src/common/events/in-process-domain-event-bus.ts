import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DomainEventName, DomainEventPayload } from '@bms/types';
import { ClsService } from 'nestjs-cls';
import type { Logger } from 'pino';
import type { RequestContext } from '../context/request-context';
import { LOGGER } from '../logging/app-logger';
import { DomainEventBus, type DomainEventInput } from './domain-event-bus';

/**
 * R1 bus: dispatches to in-process listeners. Each listener runs in a workspace context taken
 * from the event itself (not from whoever published it), and a failing listener is logged and
 * isolated: it never fails the publisher or the other listeners.
 */
@Injectable()
export class InProcessDomainEventBus extends DomainEventBus {
  constructor(
    private readonly emitter: EventEmitter2,
    private readonly cls: ClsService<RequestContext>,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    super();
  }

  async publish<N extends DomainEventName>(name: N, input: DomainEventInput<N>): Promise<void> {
    const payload = {
      ...input,
      actorUserId: input.actorUserId ?? this.cls.get('userId') ?? null,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
    } as DomainEventPayload<N>;

    const listeners = this.emitter.listeners(name) as Array<(p: DomainEventPayload<N>) => unknown>;
    await Promise.all(
      listeners.map((listener) =>
        this.cls.runWith(
          { workspaceId: payload.workspaceId, userId: payload.actorUserId ?? undefined },
          async () => {
            try {
              await listener(payload);
            } catch (err) {
              this.logger.error(
                { err, event: name, workspaceId: payload.workspaceId },
                'event listener failed',
              );
            }
          },
        ),
      ),
    );
  }
}
