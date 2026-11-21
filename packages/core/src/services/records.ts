import {
  AppError,
  relationshipsOf,
  truncateValues,
  type AgiloftRecord,
  type Relationship,
  type TableSchema,
  type TableSummary,
} from '@agiloft-control/shared';
import {
  AgiloftError,
  buildQuery,
  checkLiteral,
  resolveFields,
  SearchRequestSchema,
  type SearchRequestInput,
} from '@agiloft-control/agiloft-client';
import type { ConnectionService } from './connections.ts';

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_STRING = 4_000;

export interface SearchOutcome {
  table: string;
  records: AgiloftRecord[];
  total: number | null;
  page: number;
  pageSize: number;
  hasMore: boolean | null;
  /** The exact query string sent, for transparency. */
  query: string;
  fields: string[];
  notes: string[];
}

export interface RelatedRecords {
  outgoing: {
    field: string;
    table: string;
    column: string;
    value: unknown;
    record: AgiloftRecord | null;
    note?: string;
  }[];
  incoming: { table: string; field: string; records: AgiloftRecord[]; total: number | null }[];
  incomplete: boolean;
  notes: string[];
}

/** Agiloft errors become safe, actionable application errors. */
export function mapAgiloftError(e: unknown): never {
  if (e instanceof AppError) throw e;
  if (e instanceof AgiloftError) {
    const code =
      e.kind === 'permission'
        ? 'FORBIDDEN'
        : e.kind === 'not_found'
          ? 'NOT_FOUND'
          : e.kind === 'timeout'
            ? 'UPSTREAM_TIMEOUT'
            : e.kind === 'rate_limited'
              ? 'RATE_LIMITED'
              : e.kind === 'unsafe_url'
                ? 'UNSAFE_URL'
                : e.kind === 'validation'
                  ? 'VALIDATION_FAILED'
                  : e.kind === 'response_too_large'
                    ? 'RESPONSE_TOO_LARGE'
                    : 'UPSTREAM_ERROR';
    throw new AppError(code, `Agiloft: ${e.message}`, {
      details: { agiloftErrorKind: e.kind },
      cause: e,
    });
  }
  throw e;
}

function bounded(record: AgiloftRecord): AgiloftRecord {
  return {
    id: record.id,
    fields: truncateValues(record.fields, MAX_STRING) as Record<string, unknown>,
  };
}

export class RecordService {
  private relationshipCache = new Map<
    string,
    { at: number; rels: Relationship[]; complete: boolean }
  >();

  constructor(private readonly connections: ConnectionService) {}

  async listTables(connectionId: string, search?: string): Promise<TableSummary[]> {
    const adapter = await this.connections.adapter(connectionId);
    const tables = await adapter.listTables().catch(mapAgiloftError);
    const q = search?.trim().toLowerCase();
    return q
      ? tables.filter((t) => t.name.toLowerCase().includes(q) || t.label.toLowerCase().includes(q))
      : tables;
  }

  async describeTable(
    connectionId: string,
    table: string,
  ): Promise<TableSchema & { relationships: Relationship[] }> {
    const adapter = await this.connections.adapter(connectionId);
    const schema = await adapter.describeTable(table).catch(mapAgiloftError);
    return { ...schema, relationships: relationshipsOf(schema) };
  }

  async schemas(connectionId: string, tables: Iterable<string>): Promise<Map<string, TableSchema>> {
    const adapter = await this.connections.adapter(connectionId);
    const out = new Map<string, TableSchema>();
    for (const t of new Set(tables)) {
      try {
        out.set(t, await adapter.describeTable(t));
      } catch (e) {
        if (e instanceof AgiloftError && e.kind === 'not_found') continue;
        mapAgiloftError(e);
      }
    }
    return out;
  }

  /** Relationships across the KB; complete only when every table could be described within bounds. */
  async relationships(
    connectionId: string,
    maxTables = 40,
  ): Promise<{ rels: Relationship[]; complete: boolean }> {
    const cached = this.relationshipCache.get(connectionId);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached;
    const tables = await this.listTables(connectionId);
    const schemas = await this.schemas(
      connectionId,
      tables.slice(0, maxTables).map((t) => t.name),
    );
    const rels = [...schemas.values()].flatMap(relationshipsOf);
    const entry = { at: Date.now(), rels, complete: tables.length <= maxTables };
    this.relationshipCache.set(connectionId, entry);
    return entry;
  }

  async search(connectionId: string, input: SearchRequestInput): Promise<SearchOutcome> {
    const req = SearchRequestSchema.parse(input);
    const adapter = await this.connections.adapter(connectionId);
    const schema = await adapter.describeTable(req.table).catch(mapAgiloftError);
    const query = buildQuery(req.filters, req.combinator, schema);
    const fields = resolveFields(req.fields, schema);
    const result = await adapter
      .search({ table: req.table, query, fields, page: req.page, limit: req.pageSize })
      .catch(mapAgiloftError);
    let records = result.records.map(bounded);
    const notes: string[] = [];
    while (records.length && Buffer.byteLength(JSON.stringify(records)) > MAX_RESPONSE_BYTES) {
      records = records.slice(0, Math.max(1, Math.floor(records.length / 2)));
      if (records.length === 1) break;
    }
    if (records.length < result.records.length) {
      notes.push(
        `Response trimmed to ${records.length} records to stay within ${MAX_RESPONSE_BYTES / 1024} KB; request fewer fields or a smaller page.`,
      );
    }
    if (adapter.identity.kind === 'live') {
      notes.push(
        'Agiloft re-runs the query for every REST call, so records can shift between pages if data changes while paging.',
      );
    }
    const hasMore =
      result.total == null
        ? result.records.length === req.pageSize
          ? null
          : false
        : (req.page + 1) * req.pageSize < result.total;
    return {
      table: req.table,
      records,
      total: result.total,
      page: req.page,
      pageSize: req.pageSize,
      hasMore,
      query,
      fields,
      notes,
    };
  }

  async get(
    connectionId: string,
    table: string,
    id: string,
    fields?: string[],
  ): Promise<AgiloftRecord> {
    if (!/^\d{1,18}$/.test(id)) throw new AppError('VALIDATION_FAILED', 'Record IDs are numeric.');
    const adapter = await this.connections.adapter(connectionId);
    const schema = await adapter.describeTable(table).catch(mapAgiloftError);
    const selected = fields?.length ? resolveFields(fields, schema) : undefined;
    return bounded(await adapter.read(table, id, selected).catch(mapAgiloftError));
  }

  /**
   * Follows linked fields from a record (outgoing) and finds records in other
   * tables that link to it (incoming), using only documented search queries.
   */
  async related(
    connectionId: string,
    table: string,
    id: string,
    perTable = 10,
  ): Promise<RelatedRecords> {
    const adapter = await this.connections.adapter(connectionId);
    const schema = await adapter.describeTable(table).catch(mapAgiloftError);
    const record = await adapter.read(table, id).catch(mapAgiloftError);
    const notes: string[] = [];
    const outgoing: RelatedRecords['outgoing'] = [];
    for (const field of schema.fields.filter((f) => f.type === 'link' && f.links?.length)) {
      const link = field.links![0]!;
      const value = record.fields[field.name];
      if (value == null || value === '') continue;
      try {
        const target = await adapter.describeTable(link.table);
        const q = buildQuery(
          [{ field: link.column, op: 'eq', value: checkLiteral(String(value), field.name) }],
          'and',
          target,
        );
        const res = await adapter.search({
          table: link.table,
          query: q,
          fields: resolveFields(undefined, target),
          page: 0,
          limit: 2,
        });
        outgoing.push({
          field: field.name,
          table: link.table,
          column: link.column,
          value,
          record: res.records[0] ? bounded(res.records[0]) : null,
          ...(res.records.length > 1
            ? { note: 'More than one record matches this linked value.' }
            : {}),
        });
      } catch (e) {
        outgoing.push({
          field: field.name,
          table: link.table,
          column: link.column,
          value,
          record: null,
          note: e instanceof Error ? e.message : 'lookup failed',
        });
      }
    }
    const { rels, complete } = await this.relationships(connectionId);
    if (!complete)
      notes.push('The KB has more tables than were scanned; incoming links may be incomplete.');
    const incoming: RelatedRecords['incoming'] = [];
    for (const rel of rels.filter((r) => r.toTable === table).slice(0, 10)) {
      const value = record.fields[rel.toColumn];
      if (value == null || value === '') continue;
      try {
        const src = await adapter.describeTable(rel.fromTable);
        const q = buildQuery(
          [{ field: rel.fromField, op: 'eq', value: checkLiteral(String(value), rel.fromField) }],
          'and',
          src,
        );
        const res = await adapter.search({
          table: rel.fromTable,
          query: q,
          fields: resolveFields(undefined, src),
          page: 0,
          limit: perTable,
        });
        if (res.records.length)
          incoming.push({
            table: rel.fromTable,
            field: rel.fromField,
            records: res.records.map(bounded),
            total: res.total,
          });
      } catch (e) {
        notes.push(
          `Could not search ${rel.fromTable}: ${e instanceof Error ? e.message : 'error'}`,
        );
      }
    }
    return { outgoing, incoming, incomplete: !complete, notes };
  }
}
