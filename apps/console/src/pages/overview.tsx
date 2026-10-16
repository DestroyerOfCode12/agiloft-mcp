import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Overview } from '../lib/types';
import { formatRelative } from '../lib/format';
import { PageHeader } from '../components/layout';
import { Card, Stat, TableWrap, Td, Th } from '../components/ui';
import { EmptyState, QueryState } from '../components/states';
import { EnvironmentBadge, StatusBadge } from '../components/status';

export function OverviewPage() {
  const q = useQuery({
    queryKey: ['overview'],
    queryFn: () => api<Overview>('/api/overview'),
    refetchInterval: 15_000,
  });
  return (
    <>
      <PageHeader
        title="Overview"
        description="Connection health, capability verification, approvals and executions."
      />
      <QueryState q={q}>
        {(o) => (
          <div className="space-y-6">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Data source: {o.dataSource}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="Pending approvals"
                value={o.pendingApprovalCount}
                hint="Plans awaiting a human decision"
                to="/approvals"
              />
              <Stat
                label="Capabilities verified (documentation)"
                value={`${o.capabilitySummary.documentation.verified} / ${o.capabilitySummary.total}`}
                hint={`${o.capabilitySummary.documentation.unsupported} unsupported, ${o.capabilitySummary.documentation.unverified} unverified`}
                to="/capabilities"
              />
              <Stat
                label="Confirmed on connection"
                value={o.capabilitySummary.instance.verified}
                hint={
                  o.capabilityConnection
                    ? `${o.capabilityConnection.name}${o.capabilityConnection.mode === 'demo' ? ' · synthetic demo results' : ''}`
                    : 'No connection'
                }
              />
              <Stat
                label="Failed or partial executions"
                value={o.recentFailures.length}
                hint="Recent executions needing attention"
                to="/executions"
              />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <Card
                title="Connection health"
                actions={
                  <Link
                    to="/connections"
                    className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-100"
                  >
                    Manage
                  </Link>
                }
              >
                {o.connections.length === 0 ? (
                  <EmptyState title="No connections" />
                ) : (
                  <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                    {o.connections.map((c) => (
                      <li
                        key={c.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 font-medium">
                            {c.name} <EnvironmentBadge env={c.environment} />
                          </div>
                          <div className="text-sm text-slate-600 dark:text-slate-400">
                            {c.summary} {c.checkedAt && `· checked ${formatRelative(c.checkedAt)}`}
                          </div>
                        </div>
                        <StatusBadge
                          status={c.ok === null ? 'not_checked' : c.ok ? 'verified' : 'failure'}
                          label={c.ok === null ? 'Not verified' : c.ok ? 'Healthy' : 'Problem'}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card
                title="Pending approvals"
                actions={
                  <Link
                    to="/approvals"
                    className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-100"
                  >
                    Review
                  </Link>
                }
              >
                {o.pendingApprovals.length === 0 ? (
                  <EmptyState title="Nothing awaiting approval" />
                ) : (
                  <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                    {o.pendingApprovals.map((p) => (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2"
                      >
                        <Link
                          to={`/approvals/${p.id}`}
                          className="min-w-0 font-medium text-brand-700 hover:underline dark:text-brand-100"
                        >
                          {p.title}
                        </Link>
                        <span className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                          <EnvironmentBadge env={p.environment} /> v{p.version} ·{' '}
                          {formatRelative(p.updatedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <Card title="Recent executions">
              {o.recentExecutions.length === 0 ? (
                <EmptyState title="No executions yet">
                  Approved plans appear here once executed.
                </EmptyState>
              ) : (
                <TableWrap label="Recent executions">
                  <thead>
                    <tr>
                      <Th>Plan</Th>
                      <Th>Status</Th>
                      <Th>Environment</Th>
                      <Th>Operations</Th>
                      <Th>Requested</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {o.recentExecutions.map((e) => (
                      <tr key={e.id}>
                        <Td>
                          <Link
                            to={`/executions/${e.id}`}
                            className="font-medium text-brand-700 hover:underline dark:text-brand-100"
                          >
                            {e.planTitle}
                          </Link>
                        </Td>
                        <Td>
                          <StatusBadge status={e.status} />
                        </Td>
                        <Td>
                          <EnvironmentBadge env={e.environment} />
                        </Td>
                        <Td className="whitespace-nowrap">
                          {e.operations.succeeded} ok · {e.operations.failed} failed ·{' '}
                          {e.operations.manual} manual
                        </Td>
                        <Td className="whitespace-nowrap">
                          {formatRelative(e.createdAt)} via {e.requestedVia}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
            </Card>
          </div>
        )}
      </QueryState>
    </>
  );
}
