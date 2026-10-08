import { ClsModule, type ClsService, type ClsStore } from 'nestjs-cls';
import type { Request, Response } from 'express';
import { resolveRequestId } from '../middleware/request-id.middleware';

/** Values carried for the duration of a request or a job (AsyncLocalStorage). */
export interface RequestContext extends ClsStore {
  workspaceId?: string;
  userId?: string;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

export type RequestContextService = ClsService<RequestContext>;

export const RequestContextModule = ClsModule.forRoot({
  global: true,
  middleware: {
    mount: true,
    setup: (cls: ClsService<RequestContext>, req: Request, res: Response) => {
      cls.set('requestId', resolveRequestId(req, res));
      cls.set('ip', req.ip);
      cls.set('userAgent', req.header('user-agent'));
    },
  },
});
