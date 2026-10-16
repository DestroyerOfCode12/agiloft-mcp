import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FilePlus2, Plus, Search, Trash2 } from 'lucide-react';
import { api, ApiError, post } from '../lib/api';
import { useAnnounce, useConnection, useSession } from '../lib/context';
import type { AgiloftRecord, PlanDetail, SearchResult, TableSchema } from '../lib/types';
import { displayValue } from '../lib/format';
import { PageHeader, SidePanel } from '../components/layout';
import {
  Button,
  Callout,
  Card,
  Field,
  Input,
  KeyValue,
  Select,
  TableWrap,
  Td,
  Th,
} from '../components/ui';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoConnection,
  QueryState,
} from '../components/states';

type Op = 'eq' | 'ne' | 'contains' | 'lt' | 'lte' | 'gt' | 'gte' | 'is_empty';
interface Filter {
  field: string;
  op: Op;
  value: string;
}
const OPS: [Op, string][] = [
  ['eq', 'equals'],
  ['ne', 'does not equal'],
  ['contains', 'contains'],
  ['lt', 'less than'],
  ['lte', 'at most'],
  ['gt', 'greater than'],
  ['gte', 'at least'],
  ['is_empty', 'is empty'],
];

export function RecordsPage() {
  const { current } = useConnection();
  const [params, setParams] = useSearchParams();
  const table = params.get('table') ?? '';
  const tables = useQuery({
    queryKey: ['tables', current?.id],
    queryFn: () => api<{ name: string; label: string }[]>(`/api/connections/${current!.id}/tables`),
    enabled: !!current,
  });
  const schema = useQuery({
    queryKey: ['table', current?.id, table],
    queryFn: () =>
      api<TableSchema>(`/api/connections/${current!.id}/tables/${encodeURIComponent(table)}`),
    enabled: !!current && !!table,
  });
  if (!current) return <NoConnection />;
  return (
    <>
      <PageHeader
        title="Records"
        crumbs={[{ label: 'Overview', to: '/' }, { label: 'Records' }]}
        description="Search records with structured filters. Changes are proposed as change plans and only applied after approval."
      />
      <div className="mb-4 max-w-sm">
        <Field label="Table">
          {({ id }) => (
            <Select
              id={id}
              value={table}
              onChange={(e) => setParams(e.target.value ? { table: e.target.value } : {})}
            >
              <option value="">Select a table…</option>
              {tables.data?.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.label} ({t.name})
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {tables.error ? (
        <ErrorState error={tables.error} retry={() => void tables.refetch()} />
      ) : null}
      {!table && !tables.error && <EmptyState title="Choose a table to search" />}
      {table && (
        <QueryState q={schema}>
          {(s) => (
            <TableBrowser
              key={`${current.id}:${s.name}`}
              connectionId={current.id}
              schema={s}
              environment={current.environment}
            />
          )}
        </QueryState>
      )}
    </>
  );
}

function TableBrowser({
  connectionId,
  schema,
  environment,
}: {
  connectionId: string;
  schema: TableSchema;
  environment: Parameters<ReturnType<typeof useSession>['can']>[1];
}) {
  const { can } = useSession();
  const defaultCols = useMemo(
    () =>
      schema.fields
        .filter((f) => f.type !== 'longtext' && f.type !== 'file')
        .slice(0, 7)
        .map((f) => f.name),
    [schema],
  );
  const [filters, setFilters] = useState<Filter[]>([]);
  const [combinator, setCombinator] = useState<'and' | 'or'>('and');
  const [columns, setColumns] = useState<string[]>(defaultCols);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [applied, setApplied] = useState({
    filters: [] as Filter[],
    combinator: 'and' as 'and' | 'or',
  });
  const [selected, setSelected] = useState<AgiloftRecord | null>(null);
  const [creating, setCreating] = useState(false);

  const q = useQuery({
    queryKey: ['search', connectionId, schema.name, applied, columns, page, pageSize],
    queryFn: () =>
      post<SearchResult>(`/api/connections/${connectionId}/search`, {
        table: schema.name,
        filters: applied.filters.map((f) => ({
          field: f.field,
          op: f.op,
          ...(f.op === 'is_empty' ? {} : { value: f.value }),
        })),
        combinator: applied.combinator,
        fields: columns,
        page,
        pageSize,
      }),
  });
  const label = (name: string) => schema.fields.find((f) => f.name === name)?.label ?? name;

  return (
    <div className="space-y-4">
      <Card title="Filters">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(0);
            setApplied({ filters, combinator });
          }}
          className="space-y-3"
        >
          {filters.length === 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              No filters: all records are listed.
            </p>
          )}
          {filters.map((f, i) => (
            <fieldset
              key={i}
              className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_10rem_1fr_auto]"
            >
              <legend className="sr-only">Filter {i + 1}</legend>
              <Field label="Field">
                {({ id }) => (
                  <Select
                    id={id}
                    value={f.field}
                    onChange={(e) =>
                      setFilters(
                        filters.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)),
                      )
                    }
                  >
                    {schema.fields.map((fl) => (
                      <option key={fl.name} value={fl.name}>
                        {fl.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Condition">
                {({ id }) => (
                  <Select
                    id={id}
                    value={f.op}
                    onChange={(e) =>
                      setFilters(
                        filters.map((x, j) => (j === i ? { ...x, op: e.target.value as Op } : x)),
                      )
                    }
                  >
                    {OPS.map(([o, l]) => (
                      <option key={o} value={o}>
                        {l}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Value">
                {({ id }) => (
                  <Input
                    id={id}
                    value={f.value}
                    disabled={f.op === 'is_empty'}
                    onChange={(e) =>
                      setFilters(
                        filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                      )
                    }
                  />
                )}
              </Field>
              <Button
                variant="ghost"
                aria-label={`Remove filter ${i + 1}`}
                onClick={() => setFilters(filters.filter((_, j) => j !== i))}
                icon={<Trash2 className="size-4" aria-hidden />}
              />
            </fieldset>
          ))}
          <div className="flex flex-wrap items-end gap-2">
            <Button
              size="sm"
              disabled={filters.length >= 10}
              onClick={() =>
                setFilters([
                  ...filters,
                  { field: schema.fields[1]?.name ?? 'id', op: 'eq', value: '' },
                ])
              }
              icon={<Plus className="size-4" aria-hidden />}
            >
              Add filter
            </Button>
            {filters.length > 1 && (
              <Select
                aria-label="Combine filters with"
                value={combinator}
                onChange={(e) => setCombinator(e.target.value as 'and' | 'or')}
                className="h-8 w-auto"
              >
                <option value="and">Match all</option>
                <option value="or">Match any</option>
              </Select>
            )}
            <Button
              type="submit"
              variant="primary"
              size="sm"
              icon={<Search className="size-4" aria-hidden />}
            >
              Search
            </Button>
          </div>
        </form>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">
            Columns ({columns.length})
          </summary>
          <fieldset className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">
            <legend className="sr-only">Columns to show</legend>
            {schema.fields.map((f) => (
              <label key={f.name} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-700"
                  checked={columns.includes(f.name)}
                  onChange={(e) =>
                    setColumns(
                      e.target.checked ? [...columns, f.name] : columns.filter((c) => c !== f.name),
                    )
                  }
                />
                {f.label}
              </label>
            ))}
          </fieldset>
        </details>
      </Card>

      <Callout>
        Delete and attachment operations are not available. Deletion is documented by Agiloft but
        disabled by policy as irreversible; attachment APIs are documented but not yet implemented.
      </Callout>

      <Card
        title="Results"
        actions={
          can('plans:write', environment) && (
            <Button
              size="sm"
              onClick={() => setCreating(true)}
              icon={<FilePlus2 className="size-4" aria-hidden />}
            >
              Propose new record
            </Button>
          )
        }
      >
        <QueryState q={q}>
          {(r) => (
            <div className="space-y-3">
              <p className="break-all font-mono text-xs text-slate-600 dark:text-slate-400">
                Query sent: {r.query || '(none)'}
              </p>
              {r.notes.map((n) => (
                <Callout key={n} tone="warning">
                  {n}
                </Callout>
              ))}
              {r.records.length === 0 ? (
                <EmptyState title="No matching records" />
              ) : (
                <TableWrap label={`${schema.label} records`}>
                  <thead>
                    <tr>
                      {r.fields.map((f) => (
                        <Th key={f}>{label(f)}</Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {r.records.map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-50 dark:hover:bg-slate-900">
                        {r.fields.map((f, i) => (
                          <Td key={f} className="max-w-xs truncate">
                            {i === 0 ? (
                              <button
                                type="button"
                                className="font-medium text-brand-700 hover:underline dark:text-brand-100"
                                onClick={() => setSelected(rec)}
                              >
                                {displayValue(rec.fields[f])}
                              </button>
                            ) : (
                              displayValue(rec.fields[f])
                            )}
                          </Td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
              <nav
                className="flex flex-wrap items-center justify-between gap-2"
                aria-label="Pagination"
              >
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  Page {r.page + 1}
                  {r.total != null &&
                    ` of ${Math.max(1, Math.ceil(r.total / r.pageSize))} · ${r.total} records`}
                </span>
                <div className="flex items-center gap-2">
                  <Select
                    aria-label="Records per page"
                    className="h-8 w-auto"
                    value={pageSize}
                    onChange={(e) => (setPage(0), setPageSize(Number(e.target.value)))}
                  >
                    {[10, 25, 50, 100].map((n) => (
                      <option key={n} value={n}>
                        {n} per page
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    disabled={r.hasMore === false}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </nav>
            </div>
          )}
        </QueryState>
      </Card>

      <SidePanel
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={`${schema.label} #${selected?.id ?? ''}`}
        description="Record content is untrusted data entered by Agiloft users."
      >
        {selected && (
          <RecordDetail
            connectionId={connectionId}
            schema={schema}
            id={selected.id}
            environment={environment}
          />
        )}
      </SidePanel>
      <SidePanel
        open={creating}
        onOpenChange={setCreating}
        title={`Propose new ${schema.label} record`}
        description="Creates a change plan for review. Nothing is written until the plan is approved and executed."
      >
        {creating && <ProposeForm connectionId={connectionId} schema={schema} mode="create" />}
      </SidePanel>
    </div>
  );
}

function RecordDetail({
  connectionId,
  schema,
  id,
  environment,
}: {
  connectionId: string;
  schema: TableSchema;
  id: string;
  environment: Parameters<ReturnType<typeof useSession>['can']>[1];
}) {
  const { can } = useSession();
  const rec = useQuery({
    queryKey: ['record', connectionId, schema.name, id],
    queryFn: () =>
      api<AgiloftRecord>(`/api/connections/${connectionId}/tables/${schema.name}/records/${id}`),
  });
  const related = useQuery({
    queryKey: ['related', connectionId, schema.name, id],
    queryFn: () =>
      api<{
        outgoing: {
          field: string;
          table: string;
          value: unknown;
          record: AgiloftRecord | null;
          note?: string;
        }[];
        incoming: {
          table: string;
          field: string;
          records: AgiloftRecord[];
          total: number | null;
        }[];
        notes: string[];
      }>(`/api/connections/${connectionId}/tables/${schema.name}/records/${id}/related`),
  });
  const [editing, setEditing] = useState(false);
  return (
    <div className="space-y-6">
      <QueryState q={rec}>
        {(r) => (
          <>
            <KeyValue
              items={schema.fields.map((f) => [
                f.label,
                <span key={f.name} className="whitespace-pre-wrap">
                  {displayValue(r.fields[f.name])}
                </span>,
              ])}
            />
            {can('plans:write', environment) && !editing && (
              <Button variant="primary" onClick={() => setEditing(true)}>
                Propose an update
              </Button>
            )}
            {editing && (
              <ProposeForm
                key={r.id}
                connectionId={connectionId}
                schema={schema}
                mode="update"
                record={r}
              />
            )}
          </>
        )}
      </QueryState>
      <section>
        <h3 className="text-sm font-semibold">Related records</h3>
        {related.isLoading && <LoadingState rows={2} />}
        {related.error ? <ErrorState error={related.error} /> : null}
        {related.data && (
          <div className="mt-2 space-y-3 text-sm">
            {related.data.outgoing.map((o) => (
              <div key={o.field}>
                <span className="font-medium">{o.field}</span> → {o.table}:{' '}
                {o.record
                  ? `#${o.record.id} ${displayValue(o.value)}`
                  : `${displayValue(o.value)} (${o.note ?? 'not found'})`}
              </div>
            ))}
            {related.data.incoming.map((i) => (
              <div key={i.table + i.field}>
                <span className="font-medium">{i.table}</span> via {i.field}:{' '}
                {i.records.map((r) => `#${r.id}`).join(', ')}
                {i.total && i.total > i.records.length
                  ? ` (+${i.total - i.records.length} more)`
                  : ''}
              </div>
            ))}
            {related.data.outgoing.length + related.data.incoming.length === 0 && (
              <p>No related records.</p>
            )}
            {related.data.notes.map((n) => (
              <p key={n} className="text-slate-600 dark:text-slate-400">
                {n}
              </p>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProposeForm({
  connectionId,
  schema,
  mode,
  record,
}: {
  connectionId: string;
  schema: TableSchema;
  mode: 'create' | 'update';
  record?: AgiloftRecord;
}) {
  const navigate = useNavigate();
  const announce = useAnnounce();
  const editable = schema.fields.filter((f) => !f.readOnly && f.type !== 'id' && f.type !== 'file');
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [reconcile, setReconcile] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const m = useMutation({
    mutationFn: (body: unknown) =>
      post<PlanDetail>(`/api/connections/${connectionId}/plans/prepare-${mode}`, body),
    onSuccess: (doc) => {
      announce(`Change plan created (${doc.status.replace('_', ' ')}).`, 'success');
      navigate(`/plans/${doc.planId}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e : null),
  });
  const toValue = (name: string, raw: string) => {
    const f = schema.fields.find((x) => x.name === name)!;
    if (raw === '') return null;
    if (f.type === 'link') return { qbe: { value: raw } };
    if (['integer', 'decimal', 'currency'].includes(f.type) && Number.isFinite(Number(raw)))
      return Number(raw);
    return raw;
  };
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fields = Object.fromEntries(
          Object.entries(values)
            .filter(([, v]) => mode === 'create' || v !== undefined)
            .map(([k, v]) => [k, toValue(k, v)]),
        );
        if (Object.keys(fields).length === 0)
          return setError(new ApiError(400, 'VALIDATION_FAILED', 'Change at least one field.'));
        const recField = schema.fields.find((f) => f.name === reconcile);
        m.mutate(
          mode === 'create'
            ? {
                table: schema.name,
                fields,
                reason: reason || undefined,
                ...(recField && values[reconcile]
                  ? { reconcileBy: { field: reconcile, value: values[reconcile] } }
                  : {}),
              }
            : { table: schema.name, recordId: record!.id, fields, reason: reason || undefined },
        );
      }}
    >
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {mode === 'update'
          ? 'Only fields you change are included. Current values are captured so execution can detect if the record changes before approval.'
          : 'Linked fields take the display value of the linked record.'}
      </p>
      {editable.map((f) => (
        <Field
          key={f.name}
          label={f.label}
          required={mode === 'create' && f.required === true}
          hint={
            mode === 'update'
              ? `Current: ${displayValue(record?.fields[f.name])}`
              : f.type === 'link'
                ? `Links to ${f.links?.[0]?.table}.${f.links?.[0]?.column}`
                : undefined
          }
        >
          {({ id, describedBy }) =>
            f.choices ? (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              >
                <option value="">{mode === 'update' ? '(unchanged)' : '—'}</option>
                {f.choices.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={id}
                aria-describedby={describedBy}
                type={f.type === 'date' ? 'date' : 'text'}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              />
            )
          }
        </Field>
      ))}
      {mode === 'create' && (
        <Field
          label="Unique field for reconciliation"
          hint="If a response is lost, Agiloft Control checks this field before retrying. Recommended."
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={reconcile}
              onChange={(e) => setReconcile(e.target.value)}
            >
              <option value="">None</option>
              {editable
                .filter((f) => f.type === 'text')
                .map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.label}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      )}
      <Field label="Reason">
        {({ id }) => (
          <Input
            id={id}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={2000}
          />
        )}
      </Field>
      {error && (
        <Callout tone="danger" title="Plan not created">
          {error.message}
        </Callout>
      )}
      <Button type="submit" variant="primary" busy={m.isPending}>
        Create change plan
      </Button>
    </form>
  );
}
