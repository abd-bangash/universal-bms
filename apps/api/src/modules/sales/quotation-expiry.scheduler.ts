import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WorkspaceJobRunner } from '../../common/scheduling/workspace-job-runner';
import { TenantsService } from '../tenants/tenants.service';
import { QuotationsService } from './quotations.service';

/** Once a day marks sent quotations past their validity date as expired (Requirement 10.3). */
@Injectable()
export class QuotationExpiryScheduler {
  constructor(
    private readonly runner: WorkspaceJobRunner,
    private readonly tenants: TenantsService,
    private readonly quotations: QuotationsService,
  ) {}

  @Cron('15 1 * * *')
  async scan(): Promise<{ succeeded: string[]; failed: string[] }> {
    return this.runner.forEachWorkspace(
      await this.tenants.activeWorkspaceIds(),
      async (workspaceId) => {
        await this.quotations.expireDue(workspaceId);
      },
    );
  }
}
