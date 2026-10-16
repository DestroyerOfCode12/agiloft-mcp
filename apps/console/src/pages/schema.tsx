import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { api } from '../lib/api';
import { useConnection } from '../lib/context';
import type { Relationship, TableSchema } from '../lib/types';
import { formatDateTime } from '../lib/format';
import { PageHeader } from '../components/layout';
import { Callout, Card, Field, Input, TableWrap, Td, Th } from '../components/ui';
import { EmptyState, NoConnection, QueryState } from '../components/states';
import { Badge } from '../components/status';

type Described = TableSchema & {
  relationships: Relationship[];
  editable: boolean;
  editNote: string;
};

export function SchemaPage() {
  const { current } = useConnection();
  const { table } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const tables = useQuery({
    queryKey: ['tables', current?.id],
    queryFn: () =>
      api<{ name: string; label: string; fieldCount: number | null }[]>(
        `/api/connections/${current!.id}/tables`,
      ),
    enabled: !!current,
  });
  const detail = useQuery({
    queryKey: ['table', current?.id, table],
    queryFn: () =>
      api<Described>(`/api/connections/${current!.id}/tables/${encodeURIComponent(table!)}`),
    enabled: !!current && !!table,
  });
  if (!current) return <NoConnection />;
  return (
    <>
      <PageHeader
        title={table ? `Schema: ${detail.data?.label ?? table}` : 'Schema Explorer'}
        crumbs={[
          { label: 'Overview', to: '/' },
          { label: 'Schema Explorer', to: '/schema' },
          ...(table ? [{ label: table }] : []),
        ]}
        description="Tables, fields and linked relationships discovered through the documented metadata operation (EWTable)."
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_1fr]">
        <Card title="Tables">
          <Field label="Filter tables">
            {({ id }) => (
              <Input
                id={id}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or label"
              />
            )}
          </Field>
          <div className="mt-3">
            <QueryState q={tables}>
              {(list) => {
                const rows = list.filter((t) =>
                  `${t.name} ${t.label}`.toLowerCase().includes(search.toLowerCase()),
                );
                return rows.length === 0 ? (
                  <EmptyState title="No tables match" />
                ) : (
                  <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto">
                    {rows.map((t) => (
                      <li key={t.name}>
                        <button
                          type="button"
                          onClick={() => navigate(`/schema/${encodeURIComponent(t.name)}`)}
                          aria-current={t.name === table ? 'true' : undefined}
                          className={`w-full rounded px-2 py-1.5 text-left text-sm ${t.name === table ? 'bg-brand-50 font-medium text-brand-800 dark:bg-brand-800/30 dark:text-brand-100' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                        >
                          {t.label}
                          <span className="block font-mono text-xs text-slate-500 dark:text-slate-400">
                            {t.name}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                );
              }}
            </QueryState>
          </div>
        </Card>
        <div className="min-w-0 space-y-6">
          {!table && (
            <EmptyState title="Select a table">
              Choose a table to inspect its fields and relationships.
            </EmptyState>
          )}
          {table && (
            <QueryState q={detail}>
              {(t) => (
                <>
                  <Callout tone="info" title="Read-only schema">
                    <span className="inline-flex items-start gap-1">
                      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden /> {t.editNote}
                    </span>
                  </Callout>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Source:{' '}
                    {t.source === 'demo-adapter' ? 'demo adapter (synthetic)' : 'Agiloft EWTable'} ·
                    retrieved {formatDateTime(t.retrievedAt)}
                  </p>
                  <Card
                    title={`Fields (${t.fields.length})`}
                    actions={
                      <Link
                        to={`/records?table=${encodeURIComponent(t.name)}`}
                        className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-100"
                      >
                        Browse records
                      </Link>
                    }
                  >
                    <TableWrap label="Fields">
                      <thead>
                        <tr>
                          <Th>Field</Th>
                          <Th>Type</Th>
                          <Th>Required</Th>
                          <Th>Links to</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {t.fields.map((f) => (
                          <tr key={f.name}>
                            <Td>
                              <div className="font-medium">{f.label}</div>
                              <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                                {f.name}
                              </div>
                            </Td>
                            <Td>
                              <Badge>{f.type}</Badge>
                              {f.rawType && (
                                <div className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                                  {f.rawType}
                                </div>
                              )}
                              {f.choices && (
                                <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                                  {f.choices.join(' · ')}
                                </div>
                              )}
                              {f.readOnly && <div className="mt-1 text-xs">read-only</div>}
                            </Td>
                            <Td>
                              {f.required === null ? (
                                <Badge tone="warning">Unknown</Badge>
                              ) : f.required ? (
                                'Yes'
                              ) : (
                                'No'
                              )}
                            </Td>
                            <Td>
                              {f.links?.map((l) => (
                                <Link
                                  key={l.table + l.column}
                                  to={`/schema/${encodeURIComponent(l.table)}`}
                                  className="block font-mono text-xs text-brand-700 hover:underline dark:text-brand-100"
                                >
                                  {l.table}.{l.column}
                                </Link>
                              )) ?? '—'}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </TableWrap>
                  </Card>
                  <Card
                    title={`Relationships (${t.relationships.length})`}
                    description="Outgoing linked fields. Related tables, embedded searches and communications are not reported by EWTable."
                  >
                    {t.relationships.length === 0 ? (
                      <EmptyState title="No linked fields" />
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {t.relationships.map((r) => (
                          <li key={r.fromField} className="font-mono text-xs">
                            {r.fromTable}.{r.fromField} → {r.toTable}.{r.toColumn}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </>
              )}
            </QueryState>
          )}
        </div>
      </div>
    </>
  );
}
