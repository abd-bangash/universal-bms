import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WorkspaceJobRunner } from '../../common/scheduling/workspace-job-runner';
import { TenantsService } from '../tenants/tenants.service';
import { TasksService } from './tasks.service';

/** Every five minutes, tells each workspace about its tasks that have become due (Requirement 30.4). */
@Injectable()
export class TaskDueScheduler {
  constructor(
    private readonly runner: WorkspaceJobRunner,
    private readonly tenants: TenantsService,
    private readonly tasks: TasksService,
  ) {}

  @Cron('*/5 * * * *')
  async scan(): Promise<{ succeeded: string[]; failed: string[] }> {
    return this.runner.forEachWorkspace(
      await this.tenants.activeWorkspaceIds(),
      async (workspaceId) => {
        await this.tasks.publishDue(workspaceId);
      },
    );
  }
}
