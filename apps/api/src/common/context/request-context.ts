import { ClsModule, type ClsService, type ClsStore } from 'nestjs-cls';
import type { Request, Response } from 'express';
import { resolveRequestId } from '../middleware/request-id.middleware';

/** Values carried for the duration of a request or a job (AsyncLocalStorage). */
export interface RequestContext extends ClsStore {
  workspaceId?: string;
  userId?: string;
  /** Names of the acting user's roles, set by the auth guard; recorded on audit events. */
  actorRole?: string;
  requestId?: string;
  /** Per-request cache of the workspace configuration (see SettingsService). */
  settingsCache?: { workspaceId: string; configVersion: number; config: unknown };
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
