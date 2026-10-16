import type {
  AgiloftRecord,
  FieldSchema,
  FieldValue,
  TableSchema,
  TableSummary,
} from '@agiloft-control/shared';
import { CAPABILITIES, type InstanceCapabilityResult } from '@agiloft-control/capabilities';
import { DEMO_INSTANCE_LABEL, DEMO_KB_NAME, DEMO_TABLES } from '@agiloft-control/test-fixtures';
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
import type { DemoDataStore, DemoRow } from './demo-store.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Demo adapter: a clearly labelled stand-in for an Agiloft KB backed by
 * synthetic data. It implements the same interface as the live adapter and
 * reproduces documented behaviour that matters for safety: required-field and
 * choice validation, Query-By-Example link resolution (rejecting ambiguous
 * matches), date_updated maintenance and rules that fire on API ("Web") writes.
 * It never opens a network connection.
 */
export class DemoAgiloftAdapter implements AgiloftAdapter {
  readonly identity: AdapterIdentity = {
    kind: 'demo',
    kbName: DEMO_KB_NAME,
    instanceLabel: DEMO_INSTANCE_LABEL,
    baseUrl: null,
  };
  private locks = new Map<string, string>();

  constructor(
    private readonly store: DemoDataStore,
    private readonly opts: { now?: () => Date } = {},
  ) {}

  private now() {
    return (this.opts.now?.() ?? new Date()).toISOString();
  }

  private schema(table: string): TableSchema {
    const t = DEMO_TABLES.find((x) => x.name === table);
    if (!t)
      throw new AgiloftError('not_found', `Table "${table}" has not been found`, {
        httpStatus: 400,
      });
    return t;
  }

  async listTables(): Promise<TableSummary[]> {
    return DEMO_TABLES.map((t) => ({ name: t.name, label: t.label, fieldCount: t.fields.length }));
  }

  async describeTable(table: string): Promise<TableSchema> {
    return structuredClone(this.schema(table));
  }

  async search(p: SearchParams): Promise<SearchResult> {
    const schema = this.schema(p.table);
    const predicate = compileQuery(p.query, schema);
    const rows = (await this.store.list(p.table))
      .filter(predicate)
      .sort((a, b) => Number(a.id) - Number(b.id));
    const start = p.page * p.limit;
    return {
      total: rows.length,
      records: rows.slice(start, start + p.limit).map((r) => project(r, p.fields)),
    };
  }

  async read(table: string, id: string, fields?: string[]): Promise<AgiloftRecord> {
    this.schema(table);
    const row = await this.store.get(table, id);
    if (!row)
      throw new AgiloftError('not_found', `no data found for ${table} / ${id}`, {
        httpStatus: 400,
      });
    return project(row, fields);
  }

  async create(table: string, values: WriteValues): Promise<{ id: string }> {
    const schema = this.schema(table);
    const fault = await this.store.takeFault(table, 'create');
    if (fault?.kind === 'timeout_before_apply') throw timeout('not_sent');
    if (fault?.kind === 'reject_next_write') throw injectedRejection();
    const row = await this.validateAndResolve(schema, values, null);
    for (const field of schema.fields) {
      if (
        field.required &&
        !field.readOnly &&
        (row[field.name] == null || row[field.name] === '')
      ) {
        throw new AgiloftError(
          'validation',
          `New data for the record violates a constraint on column ${field.label}: value is required`,
          {
            httpStatus: 400,
          },
        );
      }
    }
    const ts = this.now();
    const id = await this.store.insert(table, { ...row, date_created: ts, date_updated: ts });
    await this.runSimulatedRules(table, id, null, { ...row, id });
    if (fault?.kind === 'lose_response_after_apply') throw timeout('unknown');
    return { id };
  }

  async update(table: string, id: string, values: WriteValues): Promise<AgiloftRecord> {
    const schema = this.schema(table);
    const before = await this.store.get(table, id);
    if (!before)
      throw new AgiloftError('validation', `no data found for ${table} / ${id}`, {
        httpStatus: 400,
      });
    const lockedBy = this.locks.get(`${table}:${id}`);
    if (lockedBy && lockedBy !== 'integration') {
      throw new AgiloftError('locked', `Record is locked by ${lockedBy}`, { httpStatus: 400 });
    }
    const fault = await this.store.takeFault(table, 'update');
    if (fault?.kind === 'timeout_before_apply') throw timeout('not_sent');
    if (fault?.kind === 'reject_next_write') throw injectedRejection();
    const patch = await this.validateAndResolve(schema, values, before);
    const after = await this.store.update(table, id, { ...patch, date_updated: this.now() });
    await this.runSimulatedRules(table, id, before, after);
    if (fault?.kind === 'lose_response_after_apply') throw timeout('unknown');
    return project(after);
  }

  private async validateAndResolve(
    schema: TableSchema,
    values: WriteValues,
    existing: DemoRow | null,
  ): Promise<DemoRow> {
    const out: DemoRow = {};
    for (const [name, value] of Object.entries(values)) {
      const field = schema.fields.find((f) => f.name === name);
      if (!field) {
        throw new AgiloftError(
          'validation',
          `Field ${name} has not been found in table ${schema.name}`,
          { httpStatus: 400 },
        );
      }
      if (field.readOnly) {
        throw new AgiloftError('validation', `Field ${field.label} is read-only`, {
          httpStatus: 400,
        });
      }
      out[name] = await this.coerce(field, value);
    }
    void existing;
    return out;
  }

  private async coerce(field: FieldSchema, value: FieldValue): Promise<unknown> {
    if (value === null || value === '') return null;
    if (field.type === 'link') {
      const link = field.links?.[0];
      if (!link) return value;
      const target =
        typeof value === 'object' && !Array.isArray(value) ? value.qbe.value : String(value);
      const matches = (await this.store.list(link.table)).filter(
        (r) => String(r[link.column] ?? '').toLowerCase() === target.toLowerCase(),
      );
      if (matches.length === 0) {
        throw new AgiloftError(
          'validation',
          `No linked records found for Linked Field ${field.label} with condition ${link.column}='${target}'`,
          { httpStatus: 400 },
        );
      }
      if (matches.length > 1) {
        throw new AgiloftError(
          'validation',
          `Multiple values found with condition ${link.column}='${target}' are not allowed for Linked Field ${field.label}`,
          { httpStatus: 400 },
        );
      }
      return matches[0]![link.column];
    }
    if (field.type === 'choice') {
      const v = String(value);
      if (field.choices && !field.choices.includes(v)) {
        throw new AgiloftError(
          'validation',
          `Wrong format/value pointed to: "${v}" is not a choice of ${field.label}`,
          { httpStatus: 400 },
        );
      }
      return v;
    }
    if (['integer', 'decimal', 'currency'].includes(field.type)) {
      const n = Number(value);
      if (!Number.isFinite(n))
        throw new AgiloftError('validation', `Wrong format/value pointed to: ${field.label}`, {
          httpStatus: 400,
        });
      return field.type === 'integer' ? Math.trunc(n) : n;
    }
    if (typeof value === 'object') {
      throw new AgiloftError(
        'validation',
        `Field ${field.label} does not accept linked or multiple values`,
        { httpStatus: 400 },
      );
    }
    return String(value);
  }

  /** Simulates "Create/Edit (Web)" rules so demo users see that API writes have side effects. */
  private async runSimulatedRules(
    table: string,
    id: string,
    before: DemoRow | null,
    after: DemoRow,
  ): Promise<void> {
    if (table !== 'laptop_requests') return;
    const statusChanged = before ? before.status !== after.status : after.status === 'Submitted';
    if (!statusChanged) return;
    const ts = this.now();
    await this.store.insert('notifications', {
      subject: `Laptop request ${String(after.external_ref ?? id)} is now "${String(after.status)}"`,
      recipient: String(after.requester ?? 'requester'),
      related_ref: String(after.external_ref ?? id),
      rule_name: 'Edit: notify requester on status change (simulated)',
      date_created: ts,
      date_updated: ts,
    });
  }

  async lockStatus(table: string, id: string): Promise<LockStatus> {
    const by = this.locks.get(`${table}:${id}`);
    return by ? { status: 'LOCKED', lockedBy: by, expiresInMinutes: 30 } : { status: 'NO_LOCK' };
  }
  async lock(table: string, id: string): Promise<LockStatus> {
    const key = `${table}:${id}`;
    const by = this.locks.get(key);
    if (by && by !== 'integration') return { status: 'LOCKED', lockedBy: by, expiresInMinutes: 30 };
    this.locks.set(key, 'integration');
    return { status: 'LOCKED', lockedBy: 'integration', expiresInMinutes: 30 };
  }
  async unlock(table: string, id: string): Promise<LockStatus> {
    const key = `${table}:${id}`;
    if (this.locks.get(key) === 'integration') this.locks.delete(key);
    return this.lockStatus(table, id);
  }

  async verify(): Promise<VerificationReport> {
    const checkedAt = this.now();
    const results: InstanceCapabilityResult[] = CAPABILITIES.map((c) => {
      let status: InstanceCapabilityResult['status'];
      let detail: string;
      if (c.docStatus !== 'verified' && c.id !== 'automation.workflow_records') {
        status = c.docStatus;
        detail = 'Demo adapter mirrors the documented status; nothing is available to call.';
      } else if (c.id === 'automation.workflow_records') {
        status = 'verified';
        detail =
          'Template tables (workflow_templates, approval_templates, task_templates) found by schema discovery in the demo KB.';
      } else if (c.productUse === 'used') {
        status = 'verified';
        detail = 'Exercised against the synthetic demo KB (not a real Agiloft instance).';
      } else {
        status = 'not_checked';
        detail = 'Not used by Agiloft Control.';
      }
      return { capabilityId: c.id, status, checkedAt, detail, synthetic: true };
    });
    return {
      checkedAt,
      identity: this.identity,
      ok: true,
      summary: `Demo adapter ready. ${DEMO_TABLES.length} synthetic tables. No real Agiloft instance is contacted.`,
      latencyMs: 0,
      tablesVisible: DEMO_TABLES.length,
      results,
    };
  }

  async close(): Promise<void> {}
}

function timeout(outcome: 'not_sent' | 'unknown') {
  return new AgiloftError(
    'timeout',
    'Agiloft did not respond within 20000 ms. (demo fault injection)',
    { writeOutcome: outcome },
  );
}

function injectedRejection() {
  return new AgiloftError(
    'validation',
    'Agiloft rejected the request: simulated rule validation failed (demo fault injection)',
    {
      httpStatus: 400,
    },
  );
}

function project(row: DemoRow, fields?: string[]): AgiloftRecord {
  const id = String(row.id);
  if (!fields || fields.length === 0) return { id, fields: { ...row } };
  const out: Record<string, unknown> = {};
  for (const f of new Set(['id', ...fields])) out[f] = row[f] ?? null;
  return { id, fields: out };
}

/** Parses the documented ad hoc query subset produced by `buildQuery`. */
export function compileQuery(query: string, schema: TableSchema): (row: DemoRow) => boolean {
  if (!query.trim()) return () => true;
  const orGroups = query
    .split('||')
    .map((g) => g.split('&&').map((c) => parseCondition(c.trim(), schema)));
  return (row) => orGroups.some((group) => group.every((cond) => cond(row)));
}

function parseCondition(text: string, schema: TableSchema): (row: DemoRow) => boolean {
  const m = /^([A-Za-z_][A-Za-z0-9_.]*)(!=|~=|<=|>=|=|<|>)(null|'([^']*)')$/.exec(text);
  if (!m)
    throw new AgiloftError('validation', `Unable to parse query condition: ${text.slice(0, 80)}`, {
      httpStatus: 400,
    });
  const [, name, op, rawLiteral, quoted] = m;
  const field = schema.fields.find((f) => f.name === name);
  if (!field)
    throw new AgiloftError(
      'validation',
      `Field ${name} has not been found in table ${schema.name}`,
      { httpStatus: 400 },
    );
  if (rawLiteral === 'null') {
    return (row) =>
      op === '!='
        ? row[field.name] != null && row[field.name] !== ''
        : row[field.name] == null || row[field.name] === '';
  }
  const literal = quoted ?? '';
  const asComparable = (v: unknown): number | string | null => {
    if (v == null || v === '') return null;
    if (['integer', 'decimal', 'currency', 'id'].includes(field.type)) return Number(v);
    if (field.type === 'date' || field.type === 'datetime') return parseDate(String(v));
    return String(v).toLowerCase();
  };
  const rhs = asComparable(literal);
  return (row) => {
    const lhs = asComparable(row[field.name]);
    if (op === '~=') return lhs != null && String(lhs).includes(String(rhs));
    if (op === '=') return lhs === rhs;
    if (op === '!=') return lhs !== rhs;
    if (lhs == null || rhs == null) return false;
    if (op === '<') return lhs < rhs;
    if (op === '<=') return lhs <= rhs;
    if (op === '>') return lhs > rhs;
    return lhs >= rhs;
  };
}

function parseDate(v: string): number {
  const ag = /^([A-Z][a-z]{2}) (\d{2}) (\d{4}) (\d{2}):(\d{2})$/.exec(v);
  if (ag) {
    const [, mon, d, y, h, mi] = ag;
    return Date.UTC(Number(y), MONTHS.indexOf(mon!), Number(d), Number(h), Number(mi));
  }
  const t = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isFinite(t) ? t : NaN;
}
