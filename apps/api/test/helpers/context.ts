import type { INestApplication } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../src/common/context/request-context';

/** Runs `work` the way a request of that workspace would (for calling services directly in tests). */
export function runWithWorkspace<T>(
  app: INestApplication,
  workspaceId: string,
  work: () => Promise<T>,
  userId?: string,
): Promise<T> {
  return app.get(ClsService<RequestContext>).runWith({ workspaceId, userId }, work);
}
