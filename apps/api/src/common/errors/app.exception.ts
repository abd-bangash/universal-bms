import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@bms/types';

/** Typed exception: every error the API raises on purpose carries a code from the design.md table. */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: number,
    message: string,
    readonly details?: Record<string, string[]>,
    readonly data?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export class NotFoundAppException extends AppException {
  constructor(message = 'Not found') {
    super('NOT_FOUND', 404, message);
  }
}

export class ValidationFailedException extends AppException {
  constructor(details: Record<string, string[]>, message = 'Validation failed') {
    super('VALIDATION_FAILED', 400, message, details);
  }
}

export class ExternalServiceException extends AppException {
  constructor(
    readonly provider: string,
    readonly normalizedCode: string,
    status: 502 | 503 = 502,
  ) {
    super('EXTERNAL_SERVICE_FAILED', status, 'An external service failed');
  }
}
