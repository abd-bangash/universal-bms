/** Error codes from the table in design.md "Error Handling". UNAUTHENTICATED covers a bare 401. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'TOKEN_STALE',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'PERMISSION_DENIED',
  'MODULE_DISABLED',
  'CROSS_TENANT',
  'NOT_FOUND',
  'STALE_VERSION',
  'POSSIBLE_DUPLICATE',
  'INSUFFICIENT_STOCK',
  'IDEMPOTENCY_KEY_REUSED',
  'SESSION_ALREADY_OPEN',
  'FILE_TOO_LARGE',
  'TRANSITION_NOT_ALLOWED',
  'DISCOUNT_OVER_LIMIT',
  'DEPOSIT_REQUIRED',
  'BALANCE_DUE',
  'PRODUCT_ARCHIVED',
  'REFUND_EXCEEDS_PAID',
  'FREEFORM_WINDOW_CLOSED',
  'CONTACT_OPTED_OUT',
  'UNRESOLVED_TEMPLATE_VARIABLE',
  'RATE_LIMITED',
  'EXTERNAL_SERVICE_FAILED',
  'AI_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorEnvelope {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: Record<string, string[]>;
  requestId: string;
}

export interface SuccessEnvelope<T> {
  data: T;
  meta?: { nextCursor?: string; total?: number };
}
