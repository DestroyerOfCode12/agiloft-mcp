import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/context';
import type { AuditEvent } from '../lib/types';
import { formatDateTime, timeZone } from '../lib/format';
import { PageHeader } from '../components/layout';
import { Button, Callout, Card, Field, Input, Select, TableWrap, Td, Th } from '../components/ui';
import { EmptyState, QueryState } from '../components/states';
import { StatusBadge } from '../components/status';

export function AuditPage() {
  const { can } = useSession();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const q = useQuery({
    queryKey: ['audit', qs],
    queryFn: () => api<AuditEvent[]>(`/api/audit${qs ? `?${qs}` : ''}`),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const toIso = (v: FormDataEntryValue | null) => (v ? new Date(String(v)).toISOString() : '');
    setFilters({
      actor: String(f.get('actor') ?? ''),
      environment: String(f.get('environment') ?? ''),
      action: String(f.get('action') ?? ''),
      result: String(f.get('result') ?? ''),
      from: toIso(f.get('from')),
      to: toIso(f.get('to')),
    });
  }
  return (
    <>
      <PageHeader
        title="Audit Log"
        crumbs={[{ label: 'Overview', to: '/' }, { label: 'Audit Log' }]}
        description={`Who did what, through the console or MCP. Details are redacted before storage. Times shown in ${timeZone}.`}
        actions={
          can('audit:export') && (
            <a
              href={`/api/audit/export${qs ? `?${qs}` : ''}`}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:hover:bg-slate-800"
            >
              <Download className="size-4" aria-hidden /> Export CSV
            </a>
          )
        }
      />
      <Callout>
        This log is append-only in the application but is not tamper-proof: database administrators
        can alter it. Forward it to write-once storage if you need that guarantee.
      </Callout>
      <Card className="my-4">
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Actor">
            {({ id }) => <Input id={id} name="actor" placeholder="name or email" />}
          </Field>
          <Field label="Environment">
            {({ id }) => (
              <Select id={id} name="environment">
                <option value="">All</option>
                {['demo', 'development', 'staging', 'production'].map((e) => (
                  <option key={e}>{e}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Action prefix">
            {({ id }) => <Input id={id} name="action" placeholder="plans." />}
          </Field>
          <Field label="Result">
            {({ id }) => (
              <Select id={id} name="result">
                <option value="">All</option>
                <option value="success">Success</option>
                <option value="denied">Denied</option>
                <option value="failure">Failure</option>
              </Select>
            )}
          </Field>
          <Field label="From">
            {({ id }) => <Input id={id} name="from" type="datetime-local" />}
          </Field>
          <Field label="To">{({ id }) => <Input id={id} name="to" type="datetime-local" />}</Field>
          <div className="sm:col-span-2 lg:col-span-6">
            <Button type="submit" variant="primary">
              Apply filters
            </Button>
          </div>
        </form>
      </Card>
      <QueryState
        q={q}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title="No events match" />}
      >
        {(events) => (
          <TableWrap label="Audit events">
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Result</Th>
                <Th>Environment</Th>
                <Th>Target</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {events.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(e.at)}</Td>
                  <Td className="min-w-48">
                    {e.actor}
                    <div className="text-xs text-slate-500 dark:text-slate-400">via {e.via}</div>
                  </Td>
                  <Td className="font-mono text-xs">{e.action}</Td>
                  <Td>
                    <StatusBadge status={e.result} />
                  </Td>
                  <Td>{e.environment ?? '—'}</Td>
                  <Td className="font-mono text-xs">
                    {[e.targetType, e.targetId].filter(Boolean).join(' ') || '—'}
                  </Td>
                  <Td className="min-w-64 max-w-md">
                    {e.details && (
                      <details>
                        <summary className="cursor-pointer text-xs">Show</summary>
                        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
                          {JSON.stringify(e.details, null, 2)}
                        </pre>
                      </details>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </QueryState>
    </>
  );
}
