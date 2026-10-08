import { createHash } from 'node:crypto';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { catchError, from, mergeMap, of, type Observable } from 'rxjs';
import type { RequestContext } from '../context/request-context';
import { IDEMPOTENT_KEY } from '../decorators/idempotent.decorator';
import { AppException, ValidationFailedException } from '../errors/app.exception';
import { PrismaService } from '../prisma/prisma.service';

const MAX_KEY_LENGTH = 200;
const WAIT_MS = 10_000;
const POLL_MS = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Makes `@Idempotent()` POST handlers safe to retry. The key is claimed with a unique insert
 * before the handler runs, so two concurrent requests with one key run the handler once; the
 * second waits for the first and returns its response. A failed request releases the key so the
 * client can retry; the same key with a different request is refused (409 IDEMPOTENCY_KEY_REUSED).
 * Runs inside the response envelope: the stored body is what the handler returned.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
  ) {}

  private get cls(): ClsService<RequestContext> {
    return this.moduleRef.get(ClsService, { strict: false });
  }

  /** Resolved on first use, so applications that have no idempotent routes need no database. */
  private get prisma(): PrismaService {
    return this.moduleRef.get(PrismaService, { strict: false });
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(IDEMPOTENT_KEY, context.getHandler())) return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const key = req.header('idempotency-key')?.trim();
    if (!key || key.length > MAX_KEY_LENGTH) {
      throw new ValidationFailedException({
        'Idempotency-Key': [`send a unique value of at most ${MAX_KEY_LENGTH} characters`],
      });
    }
    const workspaceId = this.cls.get('workspaceId');
    if (!workspaceId) return next.handle();

    const route = `${req.method} ${(req.route as { path?: string } | undefined)?.path ?? req.path}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify([req.params, req.query, req.body ?? null]))
      .digest('hex');

    return from(this.claim(workspaceId, key, route, requestHash)).pipe(
      mergeMap((claim) => {
        if (claim.replay) {
          res.status(claim.statusCode);
          return of(claim.body);
        }
        return next.handle().pipe(
          mergeMap(async (body: unknown) => {
            await this.prisma.scoped.idempotencyKey.updateMany({
              where: { key, route },
              data: {
                responseBody: (body === undefined
                  ? Prisma.JsonNull
                  : JSON.parse(JSON.stringify(body))) as Prisma.InputJsonValue,
                statusCode: res.statusCode,
              },
            });
            return body;
          }),
          catchError((err: unknown) =>
            from(this.prisma.scoped.idempotencyKey.deleteMany({ where: { key, route } })).pipe(
              mergeMap(() => {
                throw err;
              }),
            ),
          ),
        );
      }),
    );
  }

  private async claim(
    workspaceId: string,
    key: string,
    route: string,
    requestHash: string,
  ): Promise<{ replay: false } | { replay: true; body: unknown; statusCode: number }> {
    try {
      await this.prisma.scoped.idempotencyKey.create({
        data: { workspaceId, key, route, requestHash },
      });
      return { replay: false };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    }
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const existing = await this.prisma.scoped.idempotencyKey.findFirst({ where: { key, route } });
      if (!existing) return this.claim(workspaceId, key, route, requestHash); // released meanwhile
      if (existing.requestHash !== requestHash) {
        throw new AppException(
          'IDEMPOTENCY_KEY_REUSED',
          409,
          'This Idempotency-Key was already used for a different request',
        );
      }
      if (existing.statusCode !== null) {
        return { replay: true, body: existing.responseBody, statusCode: existing.statusCode };
      }
      if (Date.now() > deadline) {
        throw new AppException('IDEMPOTENCY_KEY_REUSED', 409, 'The first request is still running');
      }
      await sleep(POLL_MS);
    }
  }
}
