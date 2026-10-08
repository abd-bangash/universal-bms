import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { ErrorCode, ErrorEnvelope } from '@bms/types';
import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import { LOGGER } from '../logging/app-logger';
import { AppException } from '../errors/app.exception';

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'PERMISSION_DENIED',
  404: 'NOT_FOUND',
  409: 'STALE_VERSION',
  413: 'FILE_TOO_LARGE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  502: 'EXTERNAL_SERVICE_FAILED',
  503: 'EXTERNAL_SERVICE_FAILED',
};

const SAFE_MESSAGE_BY_STATUS: Record<number, string> = {
  400: 'The request is invalid',
  401: 'Authentication is required',
  403: 'You do not have permission to do this',
  404: 'Not found',
  413: 'The request is too large',
  429: 'Too many requests',
  502: 'An external service failed',
  503: 'The service is temporarily unavailable',
};

/**
 * Turns every thrown value into the error envelope of design.md. Stack traces,
 * query text and provider errors are logged with the request id but never returned.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = req.requestId ?? 'unknown';

    const body = this.toEnvelope(exception, requestId);
    if (body.statusCode >= 500) {
      this.logger.error({ requestId, err: exception }, 'unhandled error');
    }
    res.status(body.statusCode).json(body);
  }

  private toEnvelope(exception: unknown, requestId: string): ErrorEnvelope {
    if (exception instanceof AppException) {
      const status = exception.getStatus();
      return {
        statusCode: status,
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
        ...(exception.data !== undefined ? { data: exception.data } : {}),
        requestId,
      };
    }
    if (exception instanceof ThrottlerException) {
      return { statusCode: 429, code: 'RATE_LIMITED', message: 'Too many requests', requestId };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        statusCode: status,
        code: CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED'),
        message: SAFE_MESSAGE_BY_STATUS[status] ?? 'The request could not be processed',
        requestId,
      };
    }
    return {
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId,
    };
  }
}
