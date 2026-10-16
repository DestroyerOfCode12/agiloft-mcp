/**
 * Structured application errors. `message` is always safe to show to callers;
 * internal detail goes to `cause`, which is only ever logged after redaction.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  INVALID_QUERY: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STALE_RECORD: 409,
  PLAN_CHANGED: 409,
  INVALID_STATE: 409,
  DUPLICATE_EXECUTION: 409,
  APPROVAL_EXPIRED: 409,
  APPROVAL_INVALID: 409,
  CAPABILITY_UNAVAILABLE: 422,
  POLICY_DENIED: 403,
  ENVIRONMENT_MISMATCH: 409,
  UNSAFE_URL: 400,
  RATE_LIMITED: 429,
  RESPONSE_TOO_LARGE: 413,
  UPSTREAM_ERROR: 502,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_AMBIGUOUS: 502,
  DEMO_ONLY: 400,
  NOT_CONFIGURED: 503,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  correlationId?: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = options.details;
  }

  toPayload(correlationId?: string): ErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
      ...(correlationId ? { correlationId } : {}),
    };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Converts any thrown value into a payload that never leaks internals. */
export function toSafePayload(error: unknown, correlationId?: string): ErrorPayload {
  if (isAppError(error)) return error.toPayload(correlationId);
  return {
    code: 'INTERNAL',
    message: 'An unexpected error occurred. Use the correlation ID when reporting this issue.',
    ...(correlationId ? { correlationId } : {}),
  };
}
