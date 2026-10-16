import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, post } from '../lib/api';
import { useAnnounce, useSession } from '../lib/context';
import type { Execution, ExecutionSummary } from '../lib/types';
import { displayValue, formatDateTime, formatRelative, humanize, timeZone } from '../lib/format';
import { PageHeader } from '../components/layout';
import { Button, Callout, Card, KeyValue, TableWrap, Td, Th } from '../components/ui';
import { EmptyState, QueryState } from '../components/states';
import { EnvironmentBadge, StatusBadge } from '../components/status';

export function ExecutionsPage() {
  const q = useQuery({
    queryKey: ['executions'],
    queryFn: () => api<ExecutionSummary[]>('/api/executions'),
    refetchInterval: 5000,
  });
  return (
    <>
      <PageHeader
        title="Executions"
        crumbs={[{ label: 'Overview', to: '/' }, { label: 'Executions' }]}
        description="Durable, per-operation execution records. Executions survive application restarts."
      />
      <QueryState
        q={q}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState title="No executions yet">
            Executions appear after an approved plan is run.
          </EmptyState>
        }
      >
        {(list) => (
          <TableWrap label="Executions">
            <thead>
              <tr>
                <Th>Plan</Th>
                <Th>Status</Th>
                <Th>Environment</Th>
                <Th>Operations</Th>
                <Th>Requested</Th>
                <Th>Finished</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {list.map((e) => (
                <tr key={e.id}>
                  <Td>
                    <Link
                      to={`/executions/${e.id}`}
                      className="font-medium text-brand-700 hover:underline dark:text-brand-100"
                    >
                      {e.planTitle}
                    </Link>
                    <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                      {e.id}
                    </div>
                  </Td>
                  <Td>
                    <StatusBadge status={e.status} />
                  </Td>
                  <Td>
                    <EnvironmentBadge env={e.environment} />
                  </Td>
                  <Td className="whitespace-nowrap">
                    {e.operations.succeeded}/{e.operations.total} ok · {e.operations.failed} failed
                    · {e.operations.manual} manual
                  </Td>
                  <Td className="whitespace-nowrap">
                    {e.requestedByName ?? '—'} via {e.requestedVia}
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {formatRelative(e.createdAt)}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDateTime(e.finishedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </QueryState>
    </>
  );
}

const RUNNING = ['queued', 'executing'];

export function ExecutionDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { can } = useSession();
  const announce = useAnnounce();
  const q = useQuery({
    queryKey: ['execution', id],
    queryFn: () => api<Execution>(`/api/executions/${id}`),
    refetchInterval: (query) =>
      query.state.data && RUNNING.includes(query.state.data.status) ? 1500 : false,
  });
  const cancel = useMutation({
    mutationFn: () => post(`/api/executions/${id}/cancel`),
    onSuccess: () => (
      void qc.invalidateQueries({ queryKey: ['execution', id] }),
      announce('Cancellation requested. It takes effect before the next operation.', 'success')
    ),
    onError: (e) => announce(e instanceof ApiError ? e.message : 'Cancel failed.', 'error'),
  });
  return (
    <QueryState q={q}>
      {(e) => (
        <>
          <PageHeader
            title={`Execution: ${e.planTitle}`}
            crumbs={[{ label: 'Executions', to: '/executions' }, { label: e.id }]}
            actions={
              <>
                <Link
                  to={`/plans/${e.planId}`}
                  className="inline-flex h-8 items-center rounded-md border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
                >
                  View plan
                </Link>
                {RUNNING.includes(e.status) && can('executions:cancel', e.environment) && (
                  <Button
                    size="sm"
                    variant="danger"
                    busy={cancel.isPending}
                    disabled={e.cancelRequested}
                    onClick={() => cancel.mutate()}
                  >
                    {e.cancelRequested ? 'Cancellation requested' : 'Cancel remaining operations'}
                  </Button>
                )}
              </>
            }
          />
          <div className="space-y-6">
            <Card>
              <div aria-live="polite">
                <KeyValue
                  items={[
                    ['Status', <StatusBadge key="s" status={e.status} />],
                    ['Environment', <EnvironmentBadge key="e" env={e.environment} />],
                    [
                      'Plan version / hash',
                      <span key="h" className="break-all font-mono text-xs">
                        v{e.planVersion} · {e.planHash}
                      </span>,
                    ],
                    [
                      'Requested',
                      `${e.requestedByName ?? '—'} via ${e.requestedVia} · ${formatDateTime(e.createdAt)}`,
                    ],
                    [
                      'Started / finished',
                      `${formatDateTime(e.startedAt)} → ${formatDateTime(e.finishedAt)} (${timeZone})`,
                    ],
                    [
                      'Worker runs',
                      e.runCount > 1
                        ? `${e.runCount} (resumed after interruption)`
                        : String(e.runCount),
                    ],
                  ]}
                />
              </div>
              {e.summary?.guidance && (
                <div className="mt-4">
                  <Callout
                    tone={
                      e.status === 'succeeded'
                        ? 'success'
                        : e.status === 'partially_succeeded' || e.status === 'cancelled'
                          ? 'warning'
                          : RUNNING.includes(e.status)
                            ? 'info'
                            : 'danger'
                    }
                    title="Outcome and recovery"
                  >
                    {e.summary.guidance}
                  </Callout>
                </div>
              )}
            </Card>

            <Card title="Operations">
              <ol className="relative space-y-4 border-l-2 border-slate-200 pl-6 dark:border-slate-700">
                {e.operations.map((o) => (
                  <li key={o.operationId} className="relative">
                    <span
                      className="absolute -left-[1.95rem] top-1 size-3 rounded-full border-2 border-white bg-slate-400 dark:border-slate-900"
                      aria-hidden
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {o.seq + 1}. {o.title}
                      </span>
                      <StatusBadge status={o.status} />
                      {o.attempts > 1 && (
                        <span className="text-xs text-slate-600 dark:text-slate-400">
                          {o.attempts} attempts
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                      {o.operationId} · {o.kind}
                      {o.recordId && ` · record #${o.recordId}`}
                    </div>
                    {o.error && (
                      <p className="mt-1 text-sm text-red-800 dark:text-red-300">
                        {o.error.code && <span className="font-mono">{o.error.code}: </span>}
                        {o.error.message}
                      </p>
                    )}
                    {o.result && o.status !== 'manual' && (
                      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                        {Object.entries(o.result)
                          .map(([k, v]) => `${humanize(k)}: ${displayValue(v)}`)
                          .join(' · ')}
                      </p>
                    )}
                    {o.status === 'manual' && (
                      <p className="mt-1 text-sm text-violet-900 dark:text-violet-200">
                        Requires an Agiloft administrator; see the plan for instructions.
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </Card>

            <Card title="Event timeline">
              <ol className="space-y-2 text-sm">
                {e.events.map((ev) => (
                  <li key={ev.id} className="flex flex-wrap gap-x-3">
                    <time
                      className="w-40 shrink-0 text-slate-500 dark:text-slate-400"
                      dateTime={ev.at}
                    >
                      {formatDateTime(ev.at)}
                    </time>
                    <StatusBadge
                      status={
                        ev.level === 'error'
                          ? 'failure'
                          : ev.level === 'warn'
                            ? 'denied'
                            : 'pending'
                      }
                      label={ev.level}
                    />
                    <span className="min-w-0 flex-1 break-words">
                      {ev.operationId && (
                        <span className="font-mono text-xs">[{ev.operationId}] </span>
                      )}
                      {ev.message}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </>
      )}
    </QueryState>
  );
}
