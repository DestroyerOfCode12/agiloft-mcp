/**
 * Redaction for logs, audit records and error output. Errs on the side of
 * hiding: any key that looks credential-like is masked regardless of value.
 */
const SENSITIVE_KEY =
  /(pass(word)?|secret|token|authorization|api[-_]?key|cookie|credential|private[-_]?key|client[-_]?secret|refresh)/i;

const SENSITIVE_QUERY_PARAMS = [
  '$password',
  'password',
  '$login',
  'access_token',
  'refresh_token',
  'client_secret',
  'code',
  'code_verifier',
];

export const REDACTED = '[REDACTED]';

export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username) url.username = REDACTED;
    if (url.password) url.password = REDACTED;
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_PARAMS.includes(key.toLowerCase()) || SENSITIVE_KEY.test(key)) {
        url.searchParams.set(key, REDACTED);
      }
    }
    return url.toString();
  } catch {
    return redactString(raw);
  }
}

const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const INLINE_PARAM =
  /([?&](?:\$?password|\$?login|access_token|refresh_token|client_secret)=)[^&\s]*/gi;

export function redactString(value: string): string {
  return value
    .replace(BEARER, `$1 ${REDACTED}`)
    .replace(JWT_LIKE, REDACTED)
    .replace(INLINE_PARAM, `$1${REDACTED}`);
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 12) return REDACTED as unknown as T;
  if (typeof value === 'string') return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) && v != null && v !== '' ? REDACTED : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** Shows only that a secret exists, e.g. for "credentials saved" indicators. */
export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  return '••••••••';
}
