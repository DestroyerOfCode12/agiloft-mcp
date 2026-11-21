import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, Play, Send, ShieldCheck } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { api, ApiError, post } from '../lib/api';
import { useAnnounce, useSession } from '../lib/context';
import type { Execution, PlanDetail, PlanSummary } from '../lib/types';
import { displayValue, formatDateTime, formatRelative, humanize } from '../lib/format';
import { PageHeader } from '../components/layout';
import {
  Button,
  Callout,
  Card,
  Field,
  KeyValue,
  Select,
  TableWrap,
  Td,
  Th,
} from '../components/ui';
import { EmptyState, QueryState } from '../components/states';
import { Badge, EnvironmentBadge, RouteBadge, StatusBadge } from '../components/status';

export function PlansPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const q = useQuery({
    queryKey: ['plans', status],
    queryFn: () => api<PlanSummary[]>(`/api/plans${status ? `?status=${status}` : ''}`),
  });
  return (
    <>
      <PageHeader
        title="Change Plans"
        crumbs={[{ label: 'Overview', to: '/' }, { label: 'Change Plans' }]}
        description="Versioned, hash-bound plans. Any change creates a new version and invalidates earlier approvals."
      />
      <div className="mb-4 max-w-xs">
        <Field label="Status">
          {({ id }) => (
            <Select
              id={id}
              value={status}
              onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}
            >
              <option value="">All</option>
              {[
                'draft',
                'validated',
                'awaiting_approval',
                'approved',
                'executing',
                'succeeded',
                'partially_succeeded',
                'failed',
                'rejected',
                'cancelled',
              ].map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <QueryState
        q={q}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState title="No plans">
            Create one from Records or the Scenario Builder, or from an MCP client.
          </EmptyState>
        }
      >
        {(plans) => <PlanTable plans={plans} linkBase="/plans" />}
      </QueryState>
    </>
  );
}

export function PlanTable({ plans, linkBase }: { plans: PlanSummary[]; linkBase: string }) {
  return (
    <TableWrap label="Change plans">
      <thead>
        <tr>
          <Th>Plan</Th>
          <Th>Status</Th>
          <Th>Environment</Th>
          <Th>Operations</Th>
          <Th>Created by</Th>
          <Th>Updated</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
        {plans.map((p) => (
          <tr key={p.id}>
            <Td>
              <Link
                to={`${linkBase}/${p.id}`}
                className="font-medium text-brand-700 hover:underline dark:text-brand-100"
              >
                {p.title}
              </Link>
              <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                {p.id} · v{p.version}
              </div>
            </Td>
            <Td>
              <StatusBadge status={p.status} />
            </Td>
            <Td>
              <EnvironmentBadge env={p.environment} />
            </Td>
            <Td className="whitespace-nowrap">
              {p.writeCount} write · {p.manualCount} manual
            </Td>
            <Td>{p.createdByName ?? '—'}</Td>
            <Td className="whitespace-nowrap">
              <span title={formatDateTime(p.updatedAt)}>{formatRelative(p.updatedAt)}</span>
            </Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

export function usePlan(id: string | undefined, version?: number) {
  return useQuery({
    queryKey: ['plan', id, version],
    queryFn: () => api<PlanDetail>(`/api/plans/${id}${version ? `?version=${version}` : ''}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'executing' ? 2000 : false),
  });
}

export function PlanDetailPage() {
  const { id } = useParams();
  const [version, setVersion] = useState<number | undefined>();
  const q = usePlan(id, version);
  return (
    <QueryState q={q}>
      {(plan) => (
        <>
          <PageHeader
            title={plan.content.title}
            crumbs={[{ label: 'Change Plans', to: '/plans' }, { label: plan.planId }]}
            description={plan.content.summary || undefined}
            actions={<PlanActions plan={plan} />}
          />
          {plan.versions.length > 1 && (
            <div className="mb-4 max-w-xs">
              <Field label="Version">
                {({ id: fid }) => (
                  <Select
                    id={fid}
                    value={version ?? plan.version}
                    onChange={(e) => setVersion(Number(e.target.value))}
                  >
                    {plan.versions.map((v) => (
                      <option key={v.version} value={v.version}>
                        v{v.version} · {formatDateTime(v.createdAt)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          )}
          <PlanReview plan={plan} />
        </>
      )}
    </QueryState>
  );
}

function PlanActions({ plan }: { plan: PlanDetail }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const announce = useAnnounce();
  const navigate = useNavigate();
  const env = plan.content.target.environment;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['plan', plan.planId] });
  const onErr = (e: unknown) =>
    announce(e instanceof ApiError ? e.message : 'Action failed.', 'error');
  const validate = useMutation({
    mutationFn: () => post(`/api/plans/${plan.planId}/validate`),
    onSuccess: () => (
      refresh(),
      announce('Plan validated against the current schema and policy.', 'success')
    ),
    onError: onErr,
  });
  const submit = useMutation({
    mutationFn: () => post(`/api/plans/${plan.planId}/submit`),
    onSuccess: () => (refresh(), announce('Submitted for approval.', 'success')),
    onError: onErr,
  });
  const [confirm, setConfirm] = useState(false);
  const execute = useMutation({
    mutationFn: () => post<Execution>(`/api/plans/${plan.planId}/execute`),
    onSuccess: (e) => {
      announce('Execution queued.', 'success');
      navigate(`/executions/${e.id}`);
    },
    onError: (e) => (setConfirm(false), onErr(e)),
  });
  const download = () => {
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${plan.planId}-v${plan.version}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const writes = plan.content.operations.filter(
    (o) => o.kind === 'record.create' || o.kind === 'record.update',
  );
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={download}
        icon={<Download className="size-4" aria-hidden />}
      >
        JSON
      </Button>
      {can('plans:write', env) && ['draft', 'validated'].includes(plan.status) && (
        <Button size="sm" onClick={() => validate.mutate()} busy={validate.isPending}>
          Re-validate
        </Button>
      )}
      {can('plans:write', env) && plan.status === 'validated' && (
        <Button
          size="sm"
          variant="primary"
          onClick={() => submit.mutate()}
          busy={submit.isPending}
          icon={<Send className="size-4" aria-hidden />}
        >
          Submit for approval
        </Button>
      )}
      {can('plans:approve', env) && plan.status === 'awaiting_approval' && (
        <Link
          to={`/approvals/${plan.planId}`}
          className="inline-flex h-8 items-center gap-2 rounded-md bg-brand-700 px-3 text-sm font-medium text-white hover:bg-brand-800"
        >
          <ShieldCheck className="size-4" aria-hidden /> Review for approval
        </Link>
      )}
      {can('executions:run', env) && plan.status === 'approved' && (
        <Button
          size="sm"
          variant="primary"
          onClick={() => setConfirm(true)}
          icon={<Play className="size-4" aria-hidden />}
        >
          Execute
        </Button>
      )}
      {plan.execution && (
        <Link
          to={`/executions/${plan.execution.id}`}
          className="inline-flex h-8 items-center rounded-md border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
        >
          View execution
        </Link>
      )}
      <Dialog.Root open={confirm} onOpenChange={setConfirm}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(32rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl dark:bg-slate-900">
            <Dialog.Title className="flex items-center gap-2 text-lg font-semibold">
              <AlertTriangle className="size-5 text-amber-600" aria-hidden /> Execute approved plan?
            </Dialog.Title>
            <Dialog.Description asChild>
              <div className="mt-3 space-y-2 text-sm">
                <p>
                  {writes.length} write operation(s) will run against <EnvironmentBadge env={env} />{' '}
                  {plan.content.target.instanceLabel}.
                </p>
                <p>
                  Writes can trigger Agiloft rules, including emails, that cannot be undone. There
                  is no automatic rollback; failures stop the run and are reported per operation.
                </p>
                <p className="font-mono text-xs">
                  v{plan.version} · {plan.hash.slice(0, 16)}…
                </p>
              </div>
            </Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button>Cancel</Button>
              </Dialog.Close>
              <Button variant="primary" busy={execute.isPending} onClick={() => execute.mutate()}>
                Execute now
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function Section({
  title,
  children,
  description,
}: {
  title: string;
  children: ReactNode;
  description?: string;
}) {
  return (
    <Card title={title} description={description}>
      {children}
    </Card>
  );
}

/** The complete, exact plan content a reviewer approves. */
export function PlanReview({ plan }: { plan: PlanDetail }) {
  const c = plan.content;
  const errors = plan.validation?.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = plan.validation?.issues.filter((i) => i.severity === 'warning') ?? [];
  const opIndex = new Map(c.operations.map((o, i) => [o.id, i + 1]));
  return (
    <div className="space-y-6">
      <Card>
        <KeyValue
          items={[
            ['Status', <StatusBadge key="s" status={plan.status} />],
            [
              'Target',
              <span key="t" className="inline-flex flex-wrap items-center gap-2">
                <EnvironmentBadge env={c.target.environment} /> {c.target.instanceLabel} (
                {c.target.kbName})
              </span>,
            ],
            [
              'Version / hash',
              <span key="h" className="break-all font-mono text-xs">
                v{plan.version} · {plan.hash}
              </span>,
            ],
            [
              'Created',
              `${formatDateTime(plan.createdAt)} by ${plan.createdByName ?? plan.createdBy}`,
            ],
            ['Request source', humanize(c.request.source)],
            [
              'Approval',
              <span key="a">
                <StatusBadge status={plan.approval.state} />{' '}
                {plan.approval.decidedAt && (
                  <span className="ml-1 text-sm">
                    {plan.approvalDecidedByName ?? ''} · {formatDateTime(plan.approval.decidedAt)}
                    {plan.approval.expiresAt &&
                      ` · expires ${formatDateTime(plan.approval.expiresAt)}`}
                    {plan.approval.reason && ` · “${plan.approval.reason}”`}
                  </span>
                )}
              </span>,
            ],
            [
              'Execution',
              plan.execution ? (
                <Link
                  key="e"
                  to={`/executions/${plan.execution.id}`}
                  className="text-brand-700 underline dark:text-brand-100"
                >
                  <StatusBadge status={plan.execution.status} />
                </Link>
              ) : (
                'Not executed'
              ),
            ],
          ]}
        />
        {c.request.text && (
          <blockquote className="mt-4 border-l-4 border-slate-300 pl-3 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300">
            {c.request.text}
          </blockquote>
        )}
      </Card>

      {plan.validation && (
        <Section
          title="Validation"
          description={`Checked ${formatDateTime(plan.validation.validatedAt)} against the live schema, capability registry and environment policy.`}
        >
          {errors.length === 0 && warnings.length === 0 && (
            <Callout tone="success">No issues.</Callout>
          )}
          {errors.length > 0 && (
            <Callout tone="danger" title={`${errors.length} error(s) block approval`}>
              <ul className="list-disc pl-5">
                {errors.map((i, k) => (
                  <li key={k}>
                    {i.operationId && <span className="font-mono">[{i.operationId}] </span>}
                    {i.message}
                  </li>
                ))}
              </ul>
            </Callout>
          )}
          {warnings.length > 0 && (
            <div className="mt-3">
              <Callout tone="warning" title={`${warnings.length} warning(s)`}>
                <ul className="list-disc pl-5">
                  {warnings.map((i, k) => (
                    <li key={k}>
                      {i.operationId && <span className="font-mono">[{i.operationId}] </span>}
                      {i.message}
                    </li>
                  ))}
                </ul>
              </Callout>
            </div>
          )}
        </Section>
      )}

      {c.unknowns.length > 0 && (
        <Section title="Open questions">
          <ul className="space-y-1 text-sm">
            {c.unknowns.map((u) => (
              <li key={u.id}>
                {u.blocking ? (
                  <Badge tone="danger">Blocking</Badge>
                ) : (
                  <Badge tone="warning">Non-blocking</Badge>
                )}{' '}
                {u.question}{' '}
                <span className="text-slate-600 dark:text-slate-400">— {u.impact}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title={`Operations (${c.operations.length})`}
        description="Executed in dependency order. Before values were captured when the plan was prepared and are re-checked immediately before each update."
      >
        <ol className="space-y-4">
          {c.operations.map((o, i) => (
            <li key={o.id} className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">
                  {i + 1}. {o.title}
                </span>
                <Badge>{o.kind}</Badge>
                <RouteBadge route={o.route} />
                <Badge
                  tone={o.risk === 'high' ? 'danger' : o.risk === 'medium' ? 'warning' : 'neutral'}
                >
                  {humanize(o.risk)} risk
                </Badge>
                {o.irreversible && <Badge tone="danger">Irreversible</Badge>}
              </div>
              <div className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-400">
                {o.id}
                {o.table && ` · ${o.table}`}
                {o.recordId && ` #${o.recordId}`}
                {o.dependsOn.length > 0 &&
                  ` · after ${o.dependsOn.map((d) => `${opIndex.get(d) ?? '?'}. ${d}`).join(', ')}`}
              </div>
              {o.description && <p className="mt-2 text-sm">{o.description}</p>}
              {o.fields && (
                <div className="mt-3">
                  <TableWrap label={`Changes in ${o.id}`}>
                    <thead>
                      <tr>
                        <Th>Field</Th>
                        {o.kind === 'record.update' && <Th>Before</Th>}
                        <Th>{o.kind === 'record.update' ? 'After' : 'Value'}</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {Object.entries(o.fields).map(([k, v]) => (
                        <tr key={k}>
                          <Td className="font-mono text-xs">{k}</Td>
                          {o.kind === 'record.update' && (
                            <Td className="text-red-800 line-through decoration-red-400 dark:text-red-300">
                              {displayValue(o.before?.[k])}
                            </Td>
                          )}
                          <Td className="text-emerald-800 dark:text-emerald-300">
                            {displayValue(v)}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>
                  {o.expected?.dateUpdated !== undefined && (
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      Expected date_updated: {displayValue(o.expected.dateUpdated)}
                    </p>
                  )}
                  {o.reconcileBy && (
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      Reconciliation key: {o.reconcileBy.field} = “{o.reconcileBy.value}”
                    </p>
                  )}
                </div>
              )}
              {o.manualInstructions && (
                <div className="mt-3">
                  <Callout
                    tone="info"
                    title="Administrator instructions (not performed by Agiloft Control)"
                  >
                    <ol className="list-decimal space-y-1 pl-5">
                      {o.manualInstructions.map((m) => (
                        <li key={m} className="break-words">
                          {m}
                        </li>
                      ))}
                    </ol>
                  </Callout>
                </div>
              )}
              {(o.sideEffects.length > 0 || o.compensation) && (
                <div className="mt-3 text-sm">
                  {o.sideEffects.map((s) => (
                    <p key={s} className="flex gap-1">
                      <AlertTriangle
                        className="mt-0.5 size-4 shrink-0 text-amber-600"
                        aria-hidden
                      />{' '}
                      {s}
                    </p>
                  ))}
                  {o.compensation && (
                    <p className="mt-1 text-slate-600 dark:text-slate-400">
                      Recovery: {o.compensation}
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Side effects">
          {c.sideEffects.length === 0 ? (
            <p className="text-sm">None declared.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {c.sideEffects.map((s) => (
                <li key={s.id}>
                  {s.reversible ? (
                    <Badge tone="neutral">Reversible</Badge>
                  ) : (
                    <Badge tone="danger">Not reversible</Badge>
                  )}{' '}
                  {s.description}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Recovery and limits">
          <p className="text-sm">{c.recovery.strategy}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {c.recovery.limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Section>
      </div>

      {c.assumptions.length > 0 && (
        <Section title="Assumptions">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {c.assumptions.map((a) => (
              <li key={a.id}>{a.text}</li>
            ))}
          </ul>
        </Section>
      )}

      {c.capabilityEvidence.length > 0 && (
        <Section title="Capability evidence">
          <TableWrap label="Capability evidence">
            <thead>
              <tr>
                <Th>Capability</Th>
                <Th>Documentation</Th>
                <Th>Connection</Th>
                <Th>Source</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {c.capabilityEvidence.map((e) => (
                <tr key={e.capabilityId}>
                  <Td className="font-mono text-xs">{e.capabilityId}</Td>
                  <Td>
                    <StatusBadge status={e.docStatus} />
                  </Td>
                  <Td>
                    <StatusBadge status={e.instanceStatus} />
                  </Td>
                  <Td>
                    {e.evidenceUrl ? (
                      <a
                        className="text-brand-700 underline dark:text-brand-100"
                        href={e.evidenceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        Docs ({e.checkedAt})
                      </a>
                    ) : (
                      '—'
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Section>
      )}

      {c.testCases.length > 0 && (
        <Section title="Test cases">
          <ul className="space-y-2 text-sm">
            {c.testCases.map((t) => (
              <li key={t.id}>
                <span className="font-medium">{t.title}.</span> Given {t.given}, when {t.when}, then{' '}
                {t.then}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
