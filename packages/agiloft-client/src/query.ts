import { z } from 'zod';
import {
  AppError,
  LOGICAL_NAME,
  type FieldSchema,
  type TableSchema,
} from '@agiloft-control/shared';

/**
 * Structured filters compiled to the documented EWSearch ad hoc query syntax:
 * operators =, !=, ~=, <, <=, >, >=, combined with && or ||, values in single
 * quotes and `null` for empty fields. Anything the documentation does not
 * describe (escaping quotes, mixed precedence, sub-selects) is rejected.
 */
export const FilterOperatorSchema = z.enum([
  'eq',
  'ne',
  'contains',
  'lt',
  'lte',
  'gt',
  'gte',
  'is_empty',
]);
export type FilterOperator = z.infer<typeof FilterOperatorSchema>;

export const FilterSchema = z.object({
  field: z.string().regex(LOGICAL_NAME),
  op: FilterOperatorSchema,
  value: z.union([z.string().max(500), z.number()]).optional(),
});
export type Filter = z.infer<typeof FilterSchema>;

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export const SearchRequestSchema = z.object({
  table: z.string().regex(LOGICAL_NAME),
  filters: z.array(FilterSchema).max(10).default([]),
  combinator: z.enum(['and', 'or']).default('and'),
  fields: z.array(z.string().regex(LOGICAL_NAME)).max(50).optional(),
  page: z.number().int().min(0).max(10_000).default(0),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type SearchRequestInput = z.input<typeof SearchRequestSchema>;

const OP_SYMBOL: Record<Exclude<FilterOperator, 'is_empty'>, string> = {
  eq: '=',
  ne: '!=',
  contains: '~=',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
};

const TEXTUAL = new Set([
  'text',
  'longtext',
  'email',
  'url',
  'choice',
  'multichoice',
  'link',
  'unknown',
]);
const ORDERED = new Set(['integer', 'decimal', 'currency', 'date', 'datetime', 'time', 'id']);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Formats an ISO date the way the documented example does: 'Aug 24 2021 00:00'. */
export function formatAgiloftDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
  if (!m)
    throw new AppError(
      'INVALID_QUERY',
      `"${iso}" is not an ISO date (YYYY-MM-DD or YYYY-MM-DDTHH:mm).`,
    );
  const [, y, mo, d, h = '00', mi = '00'] = m;
  const month = MONTHS[Number(mo) - 1];
  if (!month) throw new AppError('INVALID_QUERY', `"${iso}" has an invalid month.`);
  return `${month} ${d} ${y} ${h}:${mi}`;
}

function invalid(message: string, field?: string): never {
  throw new AppError('INVALID_QUERY', message, field ? { details: { field } } : {});
}

export function checkLiteral(raw: string, field: string): string {
  if (raw.includes("'")) {
    invalid(
      `Values containing a single quote cannot be searched: the documented query syntax defines no escape for it.`,
      field,
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(raw))
    invalid('Values must not contain control characters.', field);
  if (raw.includes('&&') || raw.includes('||'))
    invalid('Values must not contain "&&" or "||".', field);
  return raw;
}

function literalFor(filter: Filter, field: FieldSchema): string {
  const value = filter.value;
  if (value === undefined || value === '')
    invalid(`A value is required for operator "${filter.op}".`, field.name);
  if (ORDERED.has(field.type) && typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('Numbers must be finite.', field.name);
    return `'${value}'`;
  }
  if (field.type === 'date' || field.type === 'datetime') {
    return `'${formatAgiloftDate(String(value))}'`;
  }
  if (['integer', 'decimal', 'currency', 'id'].includes(field.type)) {
    const n = Number(value);
    if (!Number.isFinite(n)) invalid(`"${String(value)}" is not a number.`, field.name);
    return `'${n}'`;
  }
  return `'${checkLiteral(String(value), field.name)}'`;
}

export function buildQuery(
  filters: readonly Filter[],
  combinator: 'and' | 'or',
  table: TableSchema,
): string {
  const byName = new Map(table.fields.map((f) => [f.name, f]));
  const parts = filters.map((filter) => {
    const field = byName.get(filter.field);
    if (!field)
      invalid(`Field "${filter.field}" does not exist in table "${table.name}".`, filter.field);
    if (filter.op === 'is_empty') return `${field.name}=null`;
    if (filter.op === 'contains' && !TEXTUAL.has(field.type)) {
      invalid(
        `"contains" is only supported on text-like fields; "${field.name}" is ${field.type}.`,
        field.name,
      );
    }
    if (['lt', 'lte', 'gt', 'gte'].includes(filter.op) && !ORDERED.has(field.type)) {
      invalid(
        `Range comparisons are only supported on numeric and date fields; "${field.name}" is ${field.type}.`,
        field.name,
      );
    }
    return `${field.name}${OP_SYMBOL[filter.op]}${literalFor(filter, field)}`;
  });
  return parts.join(combinator === 'and' ? '&&' : '||');
}

export function resolveFields(
  requested: readonly string[] | undefined,
  table: TableSchema,
): string[] {
  const names = new Set(table.fields.map((f) => f.name));
  if (!requested || requested.length === 0) {
    // Default: id plus up to 8 leading fields, to keep responses bounded.
    const preferred = table.fields
      .filter((f) => f.type !== 'longtext' && f.type !== 'file')
      .map((f) => f.name);
    return [...new Set(['id', ...preferred])].filter((n) => names.has(n)).slice(0, 9);
  }
  for (const f of requested) {
    if (!names.has(f)) invalid(`Field "${f}" does not exist in table "${table.name}".`, f);
  }
  return [...new Set(['id', ...requested])].filter((n) => names.has(n));
}
