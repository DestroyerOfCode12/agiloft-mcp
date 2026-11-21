import type {
  AgiloftRecord,
  FieldSchema,
  FieldType,
  TableSchema,
  TableSummary,
} from '@agiloft-control/shared';
import { redactUrl } from '@agiloft-control/shared';
import type { InstanceCapabilityResult } from '@agiloft-control/capabilities';
import type {
  AdapterIdentity,
  AgiloftAdapter,
  LockStatus,
  SearchParams,
  SearchResult,
  VerificationReport,
  WriteValues,
} from './adapter.ts';
import { AgiloftError } from './errors.ts';
import { encodeValues } from './encode.ts';
import { formatAgiloftDate } from './query.ts';
import { parseRetryAfter, sendRequest, sleep, type HttpResponse } from './http.ts';
import {
  validateBaseUrl,
  type DestinationPolicy,
  type ValidatedDestination,
} from './url-safety.ts';

export type LiveCredentials =
  | { method: 'password_jwt'; login: string; password: string }
  | { method: 'oauth_client_credentials'; clientId: string; clientSecret: string };

export interface RestAdapterConfig {
  baseUrl: string;
  kbName: string;
  lang: string;
  instanceLabel: string;
  credentials: LiveCredentials;
  policy: DestinationPolicy;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Bounded retries for reads only. Writes are never retried here. */
  maxReadRetries?: number;
  schemaCacheTtlMs?: number;
}

interface Token {
  value: string;
  scheme: string;
  expiresAt: number;
}

/**
 * Live adapter for the documented Agiloft REST interface (/ewws/EW*).
 * All requests use POST form bodies (documented as equivalent to GET) so that
 * record data and parameters stay out of URLs and proxy logs, plus the
 * documented /.json decorator and err_code_resp=1 for real HTTP status codes.
 */
export class RestAgiloftAdapter implements AgiloftAdapter {
  readonly identity: AdapterIdentity;
  private readonly dest: ValidatedDestination;
  private readonly cfg: Required<Omit<RestAdapterConfig, 'credentials' | 'policy'>> &
    Pick<RestAdapterConfig, 'credentials' | 'policy'>;
  private token: Token | null = null;
  private tokenPromise: Promise<Token> | null = null;
  private schemaCache = new Map<string, { at: number; schema: TableSchema }>();
  private tablesCache: { at: number; tables: TableSummary[] } | null = null;

  constructor(config: RestAdapterConfig) {
    this.dest = validateBaseUrl(config.baseUrl, config.policy);
    this.cfg = {
      timeoutMs: 20_000,
      maxResponseBytes: 5 * 1024 * 1024,
      maxReadRetries: 2,
      schemaCacheTtlMs: 5 * 60_000,
      ...config,
    };
    this.identity = {
      kind: 'live',
      kbName: config.kbName,
      instanceLabel: config.instanceLabel,
      baseUrl: redactUrl(this.dest.url.toString()),
    };
  }

  // ------------------------------------------------------------------ auth
  private async getToken(): Promise<Token> {
    if (this.token && this.token.expiresAt - 60_000 > Date.now()) return this.token;
    if (!this.tokenPromise) {
      this.tokenPromise = this.authenticate().finally(() => {
        this.tokenPromise = null;
      });
    }
    this.token = await this.tokenPromise;
    return this.token;
  }

  private async authenticate(): Promise<Token> {
    const creds = this.cfg.credentials;
    if (creds.method === 'password_jwt') {
      const form = new URLSearchParams({
        $KB: this.cfg.kbName,
        $login: creds.login,
        $password: creds.password,
        $lang: this.cfg.lang,
      });
      const res = await this.raw('POST', '/ewws/EWLogin', form, undefined, false);
      const body = this.parseJson(res);
      const access = stringField(body, 'access_token');
      if (!access)
        throw new AgiloftError('auth', 'Agiloft did not return an access token.', {
          httpStatus: res.status,
        });
      const expiresIn = Number(body.expires_in ?? 15);
      const unit = String(body.expiration_time_unit ?? 'minute');
      const ms = unit.startsWith('sec') ? expiresIn * 1000 : expiresIn * 60_000;
      return {
        value: access,
        scheme: String(body.authentication_scheme ?? 'Bearer').trim() || 'Bearer',
        expiresAt: Date.now() + ms,
      };
    }
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    });
    const res = await this.raw('POST', '/ewws/otoken', form, undefined, false);
    const body = this.parseJson(res);
    const access = stringField(body, 'access_token');
    if (!access)
      throw new AgiloftError('auth', 'Agiloft did not return an access token.', {
        httpStatus: res.status,
      });
    // The documentation describes expires_in as minutes but its example shows 3600.
    // Values up to 60 are treated as minutes (the documented configurable range);
    // larger values as seconds. Either way the shorter plausible lifetime wins.
    const v = Number(body.expires_in ?? 15);
    const ms = v <= 60 ? v * 60_000 : v * 1000;
    return { value: access, scheme: 'Bearer', expiresAt: Date.now() + ms };
  }

  // ------------------------------------------------------------- transport
  private async raw(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    form: URLSearchParams | undefined,
    query: URLSearchParams | undefined,
    authenticated: boolean,
  ): Promise<HttpResponse> {
    const headers: Record<string, string> = {};
    if (authenticated) {
      const token = await this.getToken();
      headers.Authorization = `${token.scheme} ${token.value}`;
    }
    const res = await sendRequest(this.dest, this.cfg.policy, {
      method,
      path,
      form,
      query,
      headers,
      timeoutMs: this.cfg.timeoutMs,
      maxResponseBytes: this.cfg.maxResponseBytes,
    });
    if (res.status >= 300 && res.status < 400) {
      throw new AgiloftError(
        'upstream',
        'Agiloft responded with a redirect, which is not followed for safety.',
        {
          httpStatus: res.status,
          writeOutcome: 'rejected',
        },
      );
    }
    return res;
  }

  private parseJson(res: HttpResponse): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      throw this.statusError(res, 'Agiloft returned a non-JSON response.');
    }
    if (res.status >= 400) throw this.statusError(res, messageOf(parsed));
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { success?: unknown }).success === false
    ) {
      throw this.statusError(
        { ...res, status: res.status >= 400 ? res.status : 400 },
        messageOf(parsed),
      );
    }
    return (parsed ?? {}) as Record<string, unknown>;
  }

  private statusError(res: HttpResponse, upstreamMessage: string): AgiloftError {
    const msg = sanitizeUpstreamMessage(upstreamMessage);
    const s = res.status;
    if (/token is expired|no active session|wrong authorization/i.test(msg)) {
      this.token = null;
      return new AgiloftError('auth', 'The Agiloft session token is no longer valid.', {
        httpStatus: s,
        writeOutcome: 'rejected',
      });
    }
    if (s === 401)
      return new AgiloftError('auth', 'Agiloft rejected the integration credentials.', {
        httpStatus: s,
      });
    if (s === 403)
      return new AgiloftError('permission', `Agiloft denied access: ${msg}`, { httpStatus: s });
    if (s === 404) return new AgiloftError('not_found', `Not found: ${msg}`, { httpStatus: s });
    if (s === 429) {
      return new AgiloftError('rate_limited', 'Agiloft is rate limiting requests.', {
        httpStatus: s,
        writeOutcome: 'not_sent',
        retryAfterMs: parseRetryAfter(res.headers['retry-after']),
      });
    }
    if (s >= 400 && s < 500)
      return new AgiloftError('validation', `Agiloft rejected the request: ${msg}`, {
        httpStatus: s,
      });
    if (s >= 500) {
      // A 5xx may come after the server applied a change (e.g. a failure in a
      // rule triggered by the write), so the outcome of a write is unknown.
      return new AgiloftError('upstream', `Agiloft reported a server error: ${msg}`, {
        httpStatus: s,
        writeOutcome: 'unknown',
      });
    }
    return new AgiloftError('unexpected_response', `Unexpected response from Agiloft: ${msg}`, {
      httpStatus: s,
      writeOutcome: 'unknown',
    });
  }

  /** Read call with bounded retry on transient, not-applied failures. */
  private async callRead(
    operation: string,
    params: Record<string, string | string[]>,
  ): Promise<Record<string, unknown>> {
    let attempt = 0;
    for (;;) {
      try {
        const form = this.baseForm(params);
        const res = await this.raw('POST', `/ewws/${operation}/.json`, form, undefined, true);
        return this.parseJson(res);
      } catch (e) {
        const err = e as AgiloftError;
        const transient =
          err instanceof AgiloftError &&
          (err.kind === 'network' ||
            err.kind === 'timeout' ||
            err.kind === 'rate_limited' ||
            (err.kind === 'upstream' && (err.httpStatus ?? 0) >= 502));
        const authRetry =
          err instanceof AgiloftError &&
          err.kind === 'auth' &&
          attempt === 0 &&
          this.token === null;
        if ((!transient && !authRetry) || attempt >= this.cfg.maxReadRetries) throw e;
        attempt += 1;
        const backoff =
          err.retryAfterMs ?? Math.min(250 * 2 ** attempt + Math.random() * 100, 5_000);
        await sleep(backoff);
      }
    }
  }

  /** Write call: exactly one attempt. Ambiguity is surfaced, never retried. */
  private async callWrite(
    operation: string,
    params: Record<string, string | string[]>,
    values: WriteValues,
  ): Promise<Record<string, unknown>> {
    const form = encodeValues(values, this.baseForm(params));
    const res = await this.raw('POST', `/ewws/${operation}/.json`, form, undefined, true);
    return this.parseJson(res);
  }

  private baseForm(params: Record<string, string | string[]>): URLSearchParams {
    const form = new URLSearchParams({
      $KB: this.cfg.kbName,
      $lang: this.cfg.lang,
      err_code_resp: '1',
    });
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) for (const item of v) form.append(k, item);
      else form.append(k, v);
    }
    return form;
  }

  // ------------------------------------------------------------- metadata
  async listTables(): Promise<TableSummary[]> {
    if (this.tablesCache && Date.now() - this.tablesCache.at < this.cfg.schemaCacheTtlMs)
      return this.tablesCache.tables;
    const body = await this.callRead('EWTable', { skipColumnsInfo: 'true' });
    const tables = tablesFrom(body).map((t) => ({
      name: t.name,
      label: t.label,
      fieldCount: t.fields ? t.fields.length : null,
    }));
    this.tablesCache = { at: Date.now(), tables };
    return tables;
  }

  async describeTable(table: string): Promise<TableSchema> {
    const cached = this.schemaCache.get(table);
    if (cached && Date.now() - cached.at < this.cfg.schemaCacheTtlMs) return cached.schema;
    const body = await this.callRead('EWTable', { table, includelinkedinfo: 'true' });
    const found = tablesFrom(body).find((t) => t.name === table);
    if (!found)
      throw new AgiloftError('not_found', `Table "${table}" was not returned by EWTable.`);
    const schema: TableSchema = {
      name: found.name,
      label: found.label,
      fields: found.fields ?? [],
      source: 'agiloft:EWTable',
      retrievedAt: new Date().toISOString(),
    };
    this.schemaCache.set(table, { at: Date.now(), schema });
    return schema;
  }

  // -------------------------------------------------------------- records
  async search(p: SearchParams): Promise<SearchResult> {
    const params: Record<string, string | string[]> = {
      $table: p.table,
      field: p.fields,
      page: String(p.page),
      limit: String(p.limit),
    };
    if (p.query) params.query = p.query;
    const body = await this.callRead('EWSearch', params);
    return parseSearchResult(body.result);
  }

  async read(table: string, id: string, fields?: string[]): Promise<AgiloftRecord> {
    const params: Record<string, string | string[]> = { $table: table, id };
    if (fields?.length) params.field = fields;
    const body = await this.callRead('EWRead', params);
    return toRecord(body.result, id);
  }

  /**
   * Date values in plans are ISO 8601. They are sent in the format used by the
   * documented search example ("Aug 24 2021 00:00"), which is one of the
   * formats listed in Agiloft's datetime.txt.
   */
  private async formatDates(table: string, values: WriteValues): Promise<WriteValues> {
    const schema = await this.describeTable(table);
    const out: WriteValues = { ...values };
    for (const f of schema.fields) {
      const v = out[f.name];
      if (
        (f.type === 'date' || f.type === 'datetime') &&
        typeof v === 'string' &&
        /^\d{4}-\d{2}-\d{2}/.test(v)
      ) {
        out[f.name] = formatAgiloftDate(v);
      }
    }
    return out;
  }

  async create(table: string, values: WriteValues): Promise<{ id: string }> {
    const body = await this.callWrite(
      'EWCreate',
      { $table: table },
      await this.formatDates(table, values),
    );
    const id = extractId(body.result);
    if (!id) {
      throw new AgiloftError(
        'unexpected_response',
        'EWCreate succeeded but no record ID could be read from the response.',
        {
          writeOutcome: 'unknown',
        },
      );
    }
    return { id };
  }

  async update(table: string, id: string, values: WriteValues): Promise<AgiloftRecord> {
    const body = await this.callWrite(
      'EWUpdate',
      { $table: table, id },
      await this.formatDates(table, values),
    );
    return toRecord(body.result, id);
  }

  // ---------------------------------------------------------------- locks
  private async lockCall(
    method: 'GET' | 'PUT' | 'DELETE',
    table: string,
    id: string,
  ): Promise<LockStatus> {
    const query = new URLSearchParams({
      $KB: this.cfg.kbName,
      $lang: this.cfg.lang,
      $table: table,
      id,
      err_code_resp: '1',
    });
    const res = await this.raw(method, '/ewws/EWLock/.json', undefined, query, true);
    const body = this.parseJson(res);
    const r = (body.result && typeof body.result === 'object' ? body.result : body) as Record<
      string,
      unknown
    >;
    const status = String(r.lock_status ?? 'UNKNOWN');
    return {
      status: status === 'LOCKED' || status === 'NO_LOCK' ? status : 'UNKNOWN',
      lockedBy: r.locked_by ? String(r.locked_by) : undefined,
      expiresInMinutes:
        r.lock_expires_in_minutes != null ? Number(r.lock_expires_in_minutes) : undefined,
    };
  }
  lockStatus(table: string, id: string) {
    return this.lockCall('GET', table, id);
  }
  lock(table: string, id: string) {
    return this.lockCall('PUT', table, id);
  }
  unlock(table: string, id: string) {
    return this.lockCall('DELETE', table, id);
  }

  // ---------------------------------------------------------- verification
  /**
   * Read-only probe: authenticate, list tables, describe one table, run a
   * one-record search. Nothing is written.
   */
  async verify(): Promise<VerificationReport> {
    const started = Date.now();
    const checkedAt = new Date().toISOString();
    const results: InstanceCapabilityResult[] = [];
    const add = (
      capabilityId: string,
      status: InstanceCapabilityResult['status'],
      detail: string,
    ) => results.push({ capabilityId, status, checkedAt, detail, synthetic: false });
    let tablesVisible: number | null = null;
    try {
      await this.getToken();
      add(
        this.cfg.credentials.method === 'password_jwt'
          ? 'auth.password_jwt'
          : 'auth.oauth2_client_credentials',
        'verified',
        'Token issued.',
      );
      add('interface.rest', 'verified', 'REST endpoint reachable with JSON decorator.');
      add(
        'licensing.api_access',
        'verified',
        'API calls were accepted, so API access is licensed for this KB.',
      );
    } catch (e) {
      const err = e as AgiloftError;
      const status = err.kind === 'permission' ? 'restricted' : 'unverified';
      add(
        this.cfg.credentials.method === 'password_jwt'
          ? 'auth.password_jwt'
          : 'auth.oauth2_client_credentials',
        status,
        err.message,
      );
      return {
        checkedAt,
        identity: this.identity,
        ok: false,
        summary: `Authentication failed: ${err.message}`,
        latencyMs: Date.now() - started,
        tablesVisible,
        results,
      };
    }
    try {
      const tables = await this.listTables();
      tablesVisible = tables.length;
      add(
        'schema.tables_fields',
        'verified',
        `${tables.length} tables visible to the integration user.`,
      );
      const first = tables[0];
      if (first) {
        const schema = await this.describeTable(first.name);
        const linked = schema.fields.some((f) => f.links?.length);
        add(
          'schema.linked_fields',
          linked ? 'verified' : 'not_checked',
          linked
            ? 'Linked-field info returned.'
            : `No linked fields in "${first.name}" to confirm.`,
        );
        await this.search({ table: first.name, query: '', fields: ['id'], page: 0, limit: 1 });
        add('records.search', 'verified', `Search with limit 1 succeeded on "${first.name}".`);
      }
    } catch (e) {
      const err = e as AgiloftError;
      add(
        'schema.tables_fields',
        err.kind === 'permission' ? 'restricted' : 'unverified',
        err.message,
      );
    }
    for (const id of ['records.create', 'records.update', 'records.link_by_value']) {
      add(
        id,
        'not_checked',
        'Write capabilities cannot be confirmed by a read-only probe. Use an opt-in sandbox write test.',
      );
    }
    const ok = !results.some((r) => r.status === 'unverified' || r.status === 'restricted');
    return {
      checkedAt,
      identity: this.identity,
      ok,
      summary: ok
        ? `Connected. ${tablesVisible ?? 0} tables visible.`
        : 'Connected with problems; see individual results.',
      latencyMs: Date.now() - started,
      tablesVisible,
      results,
    };
  }

  async close(): Promise<void> {
    if (!this.token) return;
    try {
      await this.raw(
        'POST',
        '/ewws/EWLogout',
        new URLSearchParams({ $KB: this.cfg.kbName, $lang: this.cfg.lang }),
        undefined,
        true,
      );
    } catch {
      // Best effort; the token expires on its own.
    } finally {
      this.token = null;
    }
  }
}

// ------------------------------------------------------------------ parsing

function stringField(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === 'string' && v ? v : null;
}

function messageOf(parsed: unknown): string {
  if (parsed && typeof parsed === 'object') {
    const p = parsed as Record<string, unknown>;
    return String(p.message ?? p.error_description ?? p.error ?? 'no message');
  }
  return 'no message';
}

/** Upstream messages can echo submitted data; keep them short and single-line. */
export function sanitizeUpstreamMessage(msg: string): string {
  return msg
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/(password|\$password)=\S+/gi, '$1=[REDACTED]')
    .slice(0, 300);
}

/** Maps Agiloft column type domains to normalised field types (heuristic; raw type is kept). */
export function mapFieldType(
  domain: string | undefined,
  columnType: string | undefined,
  linked: boolean,
): FieldType {
  if (linked) return 'link';
  const d = (domain ?? '').toLowerCase();
  const c = (columnType ?? '').toUpperCase();
  if (d.includes('autoincrement')) return 'id';
  if (d.includes('datetime')) return 'datetime';
  if (d.includes('elapsed')) return 'text';
  if (d.includes('date')) return 'date';
  if (d.includes('time')) return 'time';
  if (d.includes('currency')) return 'currency';
  if (d.includes('float') || d.includes('decimal') || d.includes('percent')) return 'decimal';
  if (d.includes('multichoice') || d.includes('multi_choice')) return 'multichoice';
  if (d.includes('choice')) return 'choice';
  if (d.includes('email')) return 'email';
  if (d.includes('url')) return 'url';
  if (d.includes('blob') || d.includes('image') || d.includes('file')) return 'file';
  if (d.includes('longtext') || d.includes('textarea') || d.includes('appendonly'))
    return 'longtext';
  if (d.includes('integer') || d.includes('long') || d.includes('number')) return 'integer';
  if (d.includes('text')) return 'text';
  if (c === 'BIGINT' || c === 'INTEGER') return 'integer';
  if (c === 'DATETIME') return 'datetime';
  if (c === 'VARCHAR') return 'text';
  return 'unknown';
}

interface ParsedTable {
  name: string;
  label: string;
  fields?: FieldSchema[];
}

export function tablesFrom(body: Record<string, unknown>): ParsedTable[] {
  const result = (body.result ?? body) as Record<string, unknown>;
  const tables = Array.isArray(result.tables) ? result.tables : Array.isArray(result) ? result : [];
  return (tables as Record<string, unknown>[])
    .map((t) => {
      const fieldsRaw = Array.isArray(t.fields)
        ? (t.fields as Record<string, unknown>[])
        : undefined;
      return {
        name: String(t.logicalName ?? t.name ?? ''),
        label: String(t.label ?? t.logicalName ?? ''),
        fields: fieldsRaw?.map((f) => {
          const linked = f.isLinked === true || Array.isArray(f.linkedInfo);
          const links = Array.isArray(f.linkedInfo)
            ? (f.linkedInfo as Record<string, unknown>[]).map((l) => ({
                table: String(l.linkedTable ?? ''),
                column: String(l.linkedColumn ?? ''),
              }))
            : undefined;
          const requiredRaw = f.required ?? f.isRequired ?? f.mandatory;
          return {
            name: String(f.columnName ?? f.name ?? ''),
            label: String(f.columnLabel ?? f.label ?? f.columnName ?? ''),
            type: mapFieldType(
              f.columnTypeDomain as string | undefined,
              f.columnType as string | undefined,
              linked,
            ),
            rawType: f.columnTypeDomain ? String(f.columnTypeDomain) : undefined,
            required:
              typeof requiredRaw === 'boolean'
                ? requiredRaw
                : requiredRaw === 'true'
                  ? true
                  : requiredRaw === 'false'
                    ? false
                    : null,
            ...(links ? { links } : {}),
          } satisfies FieldSchema;
        }),
      };
    })
    .filter((t) => t.name);
}

export function toRecord(result: unknown, fallbackId: string): AgiloftRecord {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new AgiloftError(
      'unexpected_response',
      'Agiloft returned a record in an unrecognised format.',
      { writeOutcome: 'unknown' },
    );
  }
  const fields = { ...(result as Record<string, unknown>) };
  const id = fields.id != null ? String(fields.id) : fallbackId;
  return { id, fields };
}

function extractId(result: unknown): string | null {
  if (typeof result === 'number' || (typeof result === 'string' && /^\d+$/.test(result)))
    return String(result);
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (r.id != null && /^\d+$/.test(String(r.id))) return String(r.id);
  }
  return null;
}

/**
 * The JSON shape of EWSearch results is not shown in the documentation.
 * Accepts an array of records, or an object containing one array of records
 * plus an optional numeric count; anything else is reported, not guessed.
 */
export function parseSearchResult(result: unknown): SearchResult {
  if (Array.isArray(result)) {
    return { records: result.map((r, i) => toRecord(r, String(i))), total: null };
  }
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    const arrayKey = Object.keys(r).find(
      (k) => Array.isArray(r[k]) && (r[k] as unknown[]).every((x) => x && typeof x === 'object'),
    );
    const countKey = ['count', 'length', 'total', 'size'].find(
      (k) => typeof r[k] === 'number' || (typeof r[k] === 'string' && /^\d+$/.test(String(r[k]))),
    );
    if (arrayKey) {
      return {
        records: (r[arrayKey] as unknown[]).map((x, i) => toRecord(x, String(i))),
        total: countKey ? Number(r[countKey]) : null,
      };
    }
    if (countKey && Number(r[countKey]) === 0) return { records: [], total: 0 };
  }
  throw new AgiloftError(
    'unexpected_response',
    'EWSearch returned a result shape Agiloft Control does not recognise.',
    { writeOutcome: 'not_sent' },
  );
}
