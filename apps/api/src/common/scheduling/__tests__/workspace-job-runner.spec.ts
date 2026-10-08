import { Cron } from '@nestjs/schedule';
import { Global, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { LOGGER } from '../../logging/app-logger';
import { createLogger } from '../../logging/logger';
import type { RequestContext } from '../../context/request-context';
import { SchedulingModule } from '../scheduling.module';
import { WorkspaceJobRunner } from '../workspace-job-runner';

@Injectable()
class ExampleJob {
  @Cron('0 0 * * *')
  nightly(): void {
    /* registered only to prove @Cron wiring compiles inside the module */
  }
}

@Global()
@Module({ providers: [{ provide: LOGGER, useValue: createLogger('silent') }], exports: [LOGGER] })
class TestLoggerModule {}

describe('WorkspaceJobRunner', () => {
  async function setup() {
    const moduleRef = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true }), TestLoggerModule, SchedulingModule],
      providers: [ExampleJob],
    }).compile();
    await moduleRef.init();
    return {
      moduleRef,
      runner: moduleRef.get(WorkspaceJobRunner),
      cls: moduleRef.get(ClsService<RequestContext>),
    };
  }

  it('sets the workspace context for the job and clears it afterwards', async () => {
    const { runner, cls, moduleRef } = await setup();
    const seen = await runner.runInWorkspace('ws_1', async () => cls.get('workspaceId'));
    expect(seen).toBe('ws_1');
    expect(cls.get('workspaceId')).toBeUndefined();
    await moduleRef.close();
  });

  it('runs one workspace at a time and carries on after a failure', async () => {
    const { runner, cls, moduleRef } = await setup();
    const order: string[] = [];
    const result = await runner.forEachWorkspace(['a', 'b', 'c'], async (id) => {
      expect(cls.get('workspaceId')).toBe(id);
      order.push(id);
      if (id === 'b') throw new Error('boom');
    });
    expect(order).toEqual(['a', 'b', 'c']);
    expect(result).toEqual({ succeeded: ['a', 'c'], failed: ['b'] });
    await moduleRef.close();
  });
});
