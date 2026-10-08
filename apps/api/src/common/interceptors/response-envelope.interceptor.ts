import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SuccessEnvelope } from '@bms/types';
import { map, type Observable } from 'rxjs';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator';
import { Page } from '../pagination/pagination';

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return next.handle().pipe(
      map((result: unknown) => {
        if (skip || result instanceof StreamableFile || result === undefined) return result;
        if (result instanceof Page) {
          const meta: NonNullable<SuccessEnvelope<unknown>['meta']> = {};
          if (result.nextCursor !== undefined) meta.nextCursor = result.nextCursor;
          if (result.total !== undefined) meta.total = result.total;
          return { data: result.items, meta };
        }
        return { data: result };
      }),
    );
  }
}
