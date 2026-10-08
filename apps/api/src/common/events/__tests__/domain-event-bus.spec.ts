import { Global, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DOMAIN_EVENT_NAMES, type DomainEventPayload } from '@bms/types';
import { ClsModule, ClsService } from 'nestjs-cls';
import { LOGGER } from '../../logging/app-logger';
import { createLogger } from '../../logging/logger';
import type { RequestContext } from '../../context/request-context';
import { DomainEventBus } from '../domain-event-bus';
import { DomainEventCollector } from '../domain-event-collector';
import { EventsModule } from '../events.module';
import { OnDomainEvent } from '../on-domain-event.decorator';

@Injectable()
class Recorder {
  readonly seen: Array<{ payload: DomainEventPayload<'order.created'>; workspace?: string }> = [];
  constructor(private readonly cls: ClsService<RequestContext>) {}

  @OnDomainEvent('order.created')
  record(payload: DomainEventPayload<'order.created'>): void {
    this.seen.push({ payload, workspace: this.cls.get('workspaceId') });
  }

  @OnDomainEvent('order.created')
  failing(): void {
    throw new Error('listener bug');
  }

  @OnDomainEvent('order.created')
  async asyncRecord(): Promise<void> {
    await new Promise((r) => setTimeout(r, 5));
    this.completed += 1;
  }
  completed = 0;
}

@Global()
@Module({
  providers: [Recorder, { provide: LOGGER, useValue: createLogger('silent') }],
  exports: [LOGGER],
})
class RecorderModule {}

describe('InProcessDomainEventBus', () => {
  async function setup() {
    const moduleRef = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true }), RecorderModule, EventsModule],
    }).compile();
    await moduleRef.init();
    return {
      bus: moduleRef.get(DomainEventBus),
      cls: moduleRef.get(ClsService<RequestContext>),
      recorder: moduleRef.select(RecorderModule).get(Recorder),
    };
  }

  it('delivers a typed payload with defaults for actor and time', async () => {
    const { bus, recorder } = await setup();
    await bus.publish('order.created', { workspaceId: 'ws_1', orderId: 'o_1' });
    expect(recorder.seen).toHaveLength(1);
    const { payload } = recorder.seen[0]!;
    expect(payload).toMatchObject({ workspaceId: 'ws_1', orderId: 'o_1', actorUserId: null });
    expect(new Date(payload.occurredAt).toISOString()).toBe(payload.occurredAt);
  });

  it('takes the actor from the publishing context when not given', async () => {
    const { bus, cls, recorder } = await setup();
    await cls.runWith({ userId: 'u_9' }, () =>
      bus.publish('order.created', { workspaceId: 'ws_1', orderId: 'o' }),
    );
    expect(recorder.seen[0]!.payload.actorUserId).toBe('u_9');
  });

  it('runs listeners in the workspace of the event, not of the publisher', async () => {
    const { bus, cls, recorder } = await setup();
    await cls.runWith({ workspaceId: 'ws_publisher' }, () =>
      bus.publish('order.created', { workspaceId: 'ws_event', orderId: 'o' }),
    );
    expect(recorder.seen[0]!.workspace).toBe('ws_event');
  });

  it('isolates a failing listener and waits for async listeners', async () => {
    const { bus, recorder } = await setup();
    await expect(
      bus.publish('order.created', { workspaceId: 'w', orderId: 'o' }),
    ).resolves.toBeUndefined();
    expect(recorder.seen).toHaveLength(1); // the healthy listener still ran
    expect(recorder.completed).toBe(1);
  });

  it('does nothing for an event nobody listens to', async () => {
    const { bus } = await setup();
    await expect(
      bus.publish('lead.created', { workspaceId: 'w', leadId: 'l' }),
    ).resolves.toBeUndefined();
  });

  it('knows every event name of the design table', () => {
    expect(DOMAIN_EVENT_NAMES).toHaveLength(26);
    expect(new Set(DOMAIN_EVENT_NAMES).size).toBe(26);
  });
});

describe('DomainEventCollector (publish only after commit)', () => {
  const makeBus = () => ({
    publish: jest.fn<Promise<undefined>, [string, unknown]>(async () => undefined),
  });

  it('publishes queued events in order after a commit, once', async () => {
    const bus = makeBus();
    const collector = new DomainEventCollector();
    collector.add('order.created', { workspaceId: 'w', orderId: 'o1' });
    collector.add('order.status_changed', { workspaceId: 'w', orderId: 'o1' });
    expect(bus.publish).not.toHaveBeenCalled();
    await collector.flush(bus as unknown as DomainEventBus);
    expect(bus.publish.mock.calls.map((c) => c[0])).toEqual([
      'order.created',
      'order.status_changed',
    ]);
    await collector.flush(bus as unknown as DomainEventBus);
    expect(bus.publish).toHaveBeenCalledTimes(2);
  });

  it('publishes nothing when the transaction rolled back', async () => {
    const bus = makeBus();
    const collector = new DomainEventCollector();
    collector.add('payment.confirmed', {
      workspaceId: 'w',
      paymentId: 'p',
      orderId: null,
      customerId: null,
    });
    expect(collector.size).toBe(1);
    collector.discard();
    await collector.flush(bus as unknown as DomainEventBus);
    expect(bus.publish).not.toHaveBeenCalled();
  });
});
