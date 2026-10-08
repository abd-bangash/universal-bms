import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's documented way to extend Request
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/** Idempotent: the first caller (context setup or this middleware) fixes the id for the request. */
export function resolveRequestId(req: Request, res: Response): string {
  if (!req.requestId) {
    const incoming = req.header(REQUEST_ID_HEADER);
    req.requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
  }
  return req.requestId;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    resolveRequestId(req, res);
    next();
  }
}
