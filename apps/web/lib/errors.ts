import type { ErrorCode, ErrorEnvelope } from '@bms/types';

/** An error answer from the API (or from the BFF when the API cannot be reached). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details?: Record<string, string[]>,
    readonly requestId?: string,
    /** Structured extras from the API, such as the candidates of a possible duplicate. */
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromEnvelope(envelope: ErrorEnvelope): ApiError {
    return new ApiError(
      envelope.statusCode,
      envelope.code,
      envelope.message,
      envelope.details,
      envelope.requestId,
      envelope.data,
    );
  }

  /** Whether the session is gone and the user must sign in again. */
  get isSessionExpired(): boolean {
    return this.status === 401 && this.code === 'UNAUTHENTICATED';
  }
}
