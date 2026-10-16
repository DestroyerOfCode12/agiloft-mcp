/** Thin client for the console API. Cookies carry the session; the CSRF token is held in memory only. */
let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly correlationId?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
  get kind():
    | 'unauthenticated'
    | 'forbidden'
    | 'not_found'
    | 'disconnected'
    | 'conflict'
    | 'invalid'
    | 'error' {
    if (this.status === 401) return 'unauthenticated';
    if (this.status === 403) return 'forbidden';
    if (this.status === 404) return 'not_found';
    if (this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504)
      return 'disconnected';
    if (this.status === 409) return 'conflict';
    if (this.status === 400 || this.status === 422) return 'invalid';
    return 'error';
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      'Agiloft Control is unreachable. Check your connection and try again.',
    );
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = (data ?? {}) as {
      code?: string;
      message?: string;
      correlationId?: string;
      details?: Record<string, unknown>;
    };
    throw new ApiError(
      res.status,
      d.code ?? 'ERROR',
      d.message ?? `Request failed (${res.status}).`,
      d.correlationId,
      d.details,
    );
  }
  return data as T;
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
