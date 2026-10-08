import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { Logger } from 'pino';
import type { RequestContext } from '../context/request-context';
import { LOGGER } from '../logging/app-logger';

/**
 * Scheduled jobs and queue processors have no request, so nothing sets the workspace for them.
 * They act on one workspace at a time through this runner, which sets the context that
 * `prisma.scoped` reads.
 */
@Injectable()
export class WorkspaceJobRunner {
  constructor(
    private readonly cls: ClsService<RequestContext>,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  runInWorkspace<T>(workspaceId: string, job: () => Promise<T>, userId?: string): Promise<T> {
    return this.cls.runWith({ workspaceId, userId }, job);
  }

  /** Runs the job once per workspace; one workspace failing is logged and does not stop the others. */
  async forEachWorkspace(
    workspaceIds: readonly string[],
    job: (workspaceId: string) => Promise<void>,
  ): Promise<{ succeeded: string[]; failed: string[] }> {
    const succeeded: string[] = [];
    const failed: string[] = [];
    for (const workspaceId of workspaceIds) {
      try {
        await this.runInWorkspace(workspaceId, () => job(workspaceId));
        succeeded.push(workspaceId);
      } catch (err) {
        failed.push(workspaceId);
        this.logger.error({ err, workspaceId }, 'scheduled job failed for workspace');
      }
    }
    return { succeeded, failed };
  }
}
