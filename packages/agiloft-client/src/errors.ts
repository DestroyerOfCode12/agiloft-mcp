/**
 * Errors raised by Agiloft adapters. `writeOutcome` tells the execution engine
 * whether a write could have been applied remotely, which decides between a
 * safe retry and reconciliation.
 */
export type AgiloftErrorKind =
  | 'auth'
  | 'permission'
  | 'validation'
  | 'not_found'
  | 'locked'
  | 'rate_limited'
  | 'network'
  | 'timeout'
  | 'upstream'
  | 'unsafe_url'
  | 'response_too_large'
  | 'unexpected_response';

/**
 * not_sent: the request never reached Agiloft (safe to retry)
 * rejected: Agiloft definitely refused it (do not retry unchanged)
 * unknown:  it may or may not have been applied (reconcile before anything else)
 */
export type WriteOutcome = 'not_sent' | 'rejected' | 'unknown';

export class AgiloftError extends Error {
  readonly kind: AgiloftErrorKind;
  readonly httpStatus?: number;
  readonly writeOutcome: WriteOutcome;
  readonly retryAfterMs?: number;

  constructor(
    kind: AgiloftErrorKind,
    message: string,
    opts: {
      httpStatus?: number;
      writeOutcome?: WriteOutcome;
      retryAfterMs?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = 'AgiloftError';
    this.kind = kind;
    this.httpStatus = opts.httpStatus;
    this.writeOutcome = opts.writeOutcome ?? 'rejected';
    this.retryAfterMs = opts.retryAfterMs;
  }

  /** Transient errors where the request is known not to have been processed. */
  get retryableBeforeSend(): boolean {
    return (
      this.writeOutcome === 'not_sent' && (this.kind === 'network' || this.kind === 'rate_limited')
    );
  }
}

export function isAgiloftError(e: unknown): e is AgiloftError {
  return e instanceof AgiloftError;
}
