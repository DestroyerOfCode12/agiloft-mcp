import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import * as Tabs from '@radix-ui/react-tabs';
import { AlertTriangle, CircleHelp, Plus, Sparkles, Trash2 } from 'lucide-react';
import { ApiError, post } from '../lib/api';
import { useAnnounce, useConnection, useSession } from '../lib/context';
import type { PlanDetail, ScenarioStep, Unknown } from '../lib/types';
import { displayValue, humanize } from '../lib/format';
import { PageHeader } from '../components/layout';
import { Button, Callout, Card, Field, Input, KeyValue, Select, Textarea } from '../components/ui';
import { NoConnection } from '../components/states';
import { Badge, RouteBadge, StatusBadge } from '../components/status';

const EXAMPLE =
  'When a laptop request is submitted, require manager approval. Above R20,000, require finance approval too. Create fulfilment tasks after approval, notify the requester and escalate overdue tasks.';

interface Approval {
  name: string;
  approverSource: 'requester_manager' | 'team' | 'named_user' | 'unknown';
  team?: string;
  threshold?: { op: 'gt' | 'gte'; amount: number; currency?: string };
  order: number;
}
interface Requirements {
  subject: { entity: string; table?: string };
  trigger: { event: string; statusValue?: string };
  approvals: Approval[];
  rejection: string;
  tasks?: {
    when: string;
    label: string;
    items: { name: string; team?: string; slaBusinessDays?: number }[];
    dependencies: string;
  };
  notifications: { audience: string; event: string }[];
  escalations: { target: string; after?: string }[];
  calendar: { businessCalendar?: string; timezone?: string };
}
interface Analysis {
  interpretation: {
    requirements: Requirements;
    recognised: { phrase: string; meaning: string }[];
    unrecognised: string[];
    interpreter: string;
  };
  analysis: {
    summary: string;
    mapping: Record<string, unknown>;
    steps: ScenarioStep[];
    unknowns: Unknown[];
    assumptions: { id: string; text: string; source: string }[];
    operations: {
      id: string;
      kind: string;
      title: string;
      route: string;
      table?: string;
      fields?: Record<string, unknown>;
      manualInstructions?: string[];
      dependsOn?: string[];
    }[];
    testCases: { id: string; title: string; given: string; when: string; then: string }[];
  };
  modelProviderAvailable: boolean;
}

export function ScenarioPage() {
  const { current } = useConnection();
  const { can } = useSession();
  const navigate = useNavigate();
  const announce = useAnnounce();
  const [text, setText] = useState('');
  const [useModel, setUseModel] = useState(false);
  const [structured, setStructured] = useState<Requirements>(defaultRequirements());
  const [mode, setMode] = useState<'text' | 'structured'>('text');
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const input = () => (mode === 'text' ? { text, useModel } : { requirements: structured });
  const analyse = useMutation({
    mutationFn: () => post<Analysis>(`/api/connections/${current!.id}/scenario/analyse`, input()),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
      announce(`Analysis complete: ${r.analysis.summary}`, 'success');
    },
    onError: (e) => setError(e instanceof ApiError ? e : null),
  });
  const createPlan = useMutation({
    mutationFn: () => post<PlanDetail>(`/api/connections/${current!.id}/scenario/plan`, input()),
    onSuccess: (doc) => navigate(`/plans/${doc.planId}`),
    onError: (e) => setError(e instanceof ApiError ? e : null),
  });

  if (!current) return <NoConnection />;
  const canPlan = can('plans:write', current.environment);
  return (
    <>
      <PageHeader
        title="Scenario Builder"
        crumbs={[{ label: 'Overview', to: '/' }, { label: 'Scenario Builder' }]}
        description="Describe a business process. Agiloft Control maps it to the connected KB, classifies every step by implementation route, and lists what must be configured by an administrator."
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,26rem)_1fr]">
        <Card title="Requirements">
          <Tabs.Root value={mode} onValueChange={(v) => setMode(v as 'text' | 'structured')}>
            <Tabs.List
              aria-label="Input method"
              className="mb-4 flex gap-1 rounded-md bg-slate-100 p-1 dark:bg-slate-800"
            >
              {(
                [
                  ['text', 'Plain language'],
                  ['structured', 'Structured form'],
                ] as const
              ).map(([v, l]) => (
                <Tabs.Trigger
                  key={v}
                  value={v}
                  className="flex-1 rounded px-3 py-1.5 text-sm font-medium text-slate-700 data-[state=active]:bg-white data-[state=active]:shadow-sm dark:text-slate-300 dark:data-[state=active]:bg-slate-950"
                >
                  {l}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <Tabs.Content value="text" className="space-y-3">
              <Field
                label="Scenario"
                hint="The built-in interpreter is deterministic: it recognises common approval, task, notification and escalation phrasing and lists anything it did not understand."
              >
                {({ id, describedBy }) => (
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    rows={7}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={EXAMPLE}
                  />
                )}
              </Field>
              <Button size="sm" variant="ghost" onClick={() => setText(EXAMPLE)}>
                Use the laptop-request example
              </Button>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-brand-700"
                  checked={useModel}
                  onChange={(e) => setUseModel(e.target.checked)}
                />
                <span>
                  Interpret with the configured model provider
                  <span className="block text-xs text-slate-600 dark:text-slate-400">
                    Only the scenario text is sent to the provider; record data never is. If no
                    provider is configured, use the structured form.
                  </span>
                </span>
              </label>
            </Tabs.Content>
            <Tabs.Content value="structured">
              <StructuredForm value={structured} onChange={setStructured} />
            </Tabs.Content>
          </Tabs.Root>
          {error && (
            <div className="mt-4">
              <Callout tone="danger" title="Could not analyse">
                {error.message}
              </Callout>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              busy={analyse.isPending}
              disabled={mode === 'text' && text.trim().length < 10}
              onClick={() => analyse.mutate()}
              icon={<Sparkles className="size-4" aria-hidden />}
            >
              Analyse
            </Button>
            {result && canPlan && (
              <Button busy={createPlan.isPending} onClick={() => createPlan.mutate()}>
                Create change plan
              </Button>
            )}
          </div>
          {!canPlan && (
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              You can analyse scenarios; creating plans requires the operator role in this
              environment.
            </p>
          )}
        </Card>
        <div className="min-w-0">
          {result ? (
            <AnalysisView a={result} />
          ) : (
            <Callout>
              Results appear here: a breakdown into trigger, data, conditions, approvers, order,
              tasks, notifications, deadlines, escalations, permissions, audit, failure handling and
              tests.
            </Callout>
          )}
        </div>
      </div>
    </>
  );
}

function defaultRequirements(): Requirements {
  return {
    subject: { entity: 'laptop request' },
    trigger: { event: 'submitted', statusValue: 'Submitted' },
    approvals: [
      { name: 'Manager approval', approverSource: 'requester_manager', order: 1 },
      {
        name: 'Finance approval',
        approverSource: 'team',
        team: 'Finance',
        threshold: { op: 'gt', amount: 20000, currency: 'ZAR' },
        order: 2,
      },
    ],
    rejection: 'reject_request',
    tasks: { when: 'after_approval', label: 'fulfilment', items: [], dependencies: 'sequential' },
    notifications: [{ audience: 'requester', event: 'status change' }],
    escalations: [{ target: 'overdue_tasks' }],
    calendar: {},
  };
}

function StructuredForm({
  value,
  onChange,
}: {
  value: Requirements;
  onChange: (r: Requirements) => void;
}) {
  const set = (patch: Partial<Requirements>) => onChange({ ...value, ...patch });
  const setApproval = (i: number, patch: Partial<Approval>) =>
    set({ approvals: value.approvals.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  return (
    <div className="space-y-4">
      <Field label="Record type (entity)" required>
        {({ id }) => (
          <Input
            id={id}
            value={value.subject.entity}
            onChange={(e) => set({ subject: { entity: e.target.value } })}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Trigger">
          {({ id }) => (
            <Select
              id={id}
              value={value.trigger.event}
              onChange={(e) => set({ trigger: { ...value.trigger, event: e.target.value } })}
            >
              {['created', 'submitted', 'updated', 'status_change'].map((v) => (
                <option key={v} value={v}>
                  {humanize(v)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Status value">
          {({ id }) => (
            <Input
              id={id}
              value={value.trigger.statusValue ?? ''}
              onChange={(e) =>
                set({ trigger: { ...value.trigger, statusValue: e.target.value || undefined } })
              }
            />
          )}
        </Field>
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Approvals (in order)</legend>
        {value.approvals.map((a, i) => (
          <div
            key={i}
            className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-700"
          >
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name">
                {({ id }) => (
                  <Input
                    id={id}
                    value={a.name}
                    onChange={(e) => setApproval(i, { name: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Approver">
                {({ id }) => (
                  <Select
                    id={id}
                    value={a.approverSource}
                    onChange={(e) =>
                      setApproval(i, {
                        approverSource: e.target.value as Approval['approverSource'],
                      })
                    }
                  >
                    <option value="requester_manager">Requester's manager</option>
                    <option value="team">Team queue</option>
                    <option value="unknown">Not decided</option>
                  </Select>
                )}
              </Field>
              {a.approverSource === 'team' && (
                <Field label="Team">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={a.team ?? ''}
                      onChange={(e) => setApproval(i, { team: e.target.value })}
                    />
                  )}
                </Field>
              )}
              <Field label="Only above amount" hint="Leave empty for always">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    inputMode="decimal"
                    value={a.threshold?.amount ?? ''}
                    onChange={(e) =>
                      setApproval(i, {
                        threshold: e.target.value
                          ? {
                              op: 'gt',
                              amount: Number(e.target.value),
                              currency: a.threshold?.currency ?? 'ZAR',
                            }
                          : undefined,
                      })
                    }
                  />
                )}
              </Field>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                set({
                  approvals: value.approvals
                    .filter((_, j) => j !== i)
                    .map((x, j) => ({ ...x, order: j + 1 })),
                })
              }
              icon={<Trash2 className="size-4" aria-hidden />}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          onClick={() =>
            set({
              approvals: [
                ...value.approvals,
                { name: 'Approval', approverSource: 'unknown', order: value.approvals.length + 1 },
              ],
            })
          }
          icon={<Plus className="size-4" aria-hidden />}
        >
          Add approval
        </Button>
      </fieldset>
      <Field label="On rejection">
        {({ id }) => (
          <Select
            id={id}
            value={value.rejection}
            onChange={(e) => set({ rejection: e.target.value })}
          >
            <option value="reject_request">Reject the request</option>
            <option value="return_to_requester">Return to requester</option>
            <option value="unspecified">Not decided</option>
          </Select>
        )}
      </Field>
      <Field
        label="Fulfilment tasks (one per line)"
        hint="Optional: Name | Team | SLA business days"
      >
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            rows={3}
            aria-describedby={describedBy}
            defaultValue={value.tasks?.items
              .map((t) =>
                [t.name, t.team, t.slaBusinessDays].filter((x) => x !== undefined).join(' | '),
              )
              .join('\n')}
            onBlur={(e) => {
              const items = e.target.value
                .split('\n')
                .map((l) => l.split('|').map((x) => x.trim()))
                .filter((p) => p[0])
                .map(([name, team, sla]) => ({
                  name: name!,
                  ...(team ? { team } : {}),
                  ...(sla && Number.isFinite(Number(sla)) ? { slaBusinessDays: Number(sla) } : {}),
                }));
              set({
                tasks: {
                  when: 'after_approval',
                  label: 'fulfilment',
                  items,
                  dependencies: 'sequential',
                },
              });
            }}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Time zone">
          {({ id }) => (
            <Input
              id={id}
              placeholder="e.g. Africa/Johannesburg"
              value={value.calendar.timezone ?? ''}
              onChange={(e) =>
                set({ calendar: { ...value.calendar, timezone: e.target.value || undefined } })
              }
            />
          )}
        </Field>
        <Field label="Business calendar">
          {({ id }) => (
            <Input
              id={id}
              placeholder="e.g. SA public holidays"
              value={value.calendar.businessCalendar ?? ''}
              onChange={(e) =>
                set({
                  calendar: { ...value.calendar, businessCalendar: e.target.value || undefined },
                })
              }
            />
          )}
        </Field>
      </div>
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  trigger: 'Trigger',
  tables_fields: 'Tables and fields',
  conditions: 'Conditions and branching',
  approver_resolution: 'Approver resolution',
  approval_order: 'Approval order and rejection',
  tasks: 'Tasks and dependencies',
  notifications: 'Notifications',
  deadlines: 'Deadlines, calendar and time zone',
  escalations: 'Escalations',
  permissions: 'Permissions',
  audit: 'Audit evidence',
  failure_retry: 'Failure and retry',
  test_cases: 'Test cases',
};

function AnalysisView({ a }: { a: Analysis }) {
  const { analysis, interpretation } = a;
  const unknown = new Map(analysis.unknowns.map((u) => [u.id, u]));
  const blocking = analysis.unknowns.filter((u) => u.blocking);
  return (
    <div className="space-y-6">
      <Callout tone={blocking.length ? 'warning' : 'info'} title="Summary">
        {analysis.summary}
      </Callout>
      <Card title="Interpretation" description={`Interpreter: ${interpretation.interpreter}`}>
        {interpretation.recognised.length > 0 && (
          <ul className="space-y-1 text-sm">
            {interpretation.recognised.map((r, i) => (
              <li key={i}>
                <q className="text-slate-600 dark:text-slate-400">{r.phrase}</q> → {r.meaning}
              </li>
            ))}
          </ul>
        )}
        {interpretation.unrecognised.length > 0 && (
          <div className="mt-3">
            <Callout tone="warning" title="Not understood (ignored)">
              <ul className="list-disc pl-5">
                {interpretation.unrecognised.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </Callout>
          </div>
        )}
        <div className="mt-3">
          <KeyValue
            items={Object.entries(analysis.mapping).map(([k, v]) => [
              humanize(k.replace(/([A-Z])/g, ' $1').toLowerCase()),
              displayValue(v),
            ])}
          />
        </div>
      </Card>

      {analysis.unknowns.length > 0 && (
        <Card title={`Open questions (${analysis.unknowns.length})`}>
          <ul className="space-y-2">
            {analysis.unknowns.map((u) => (
              <li key={u.id} className="flex gap-2 text-sm">
                {u.blocking ? (
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0 text-red-700 dark:text-red-400"
                    aria-hidden
                  />
                ) : (
                  <CircleHelp
                    className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
                    aria-hidden
                  />
                )}
                <span>
                  <span className="font-medium">{u.question}</span>{' '}
                  {u.blocking ? (
                    <Badge tone="danger">Blocking</Badge>
                  ) : (
                    <Badge tone="warning">Non-blocking</Badge>
                  )}
                  <span className="block text-slate-600 dark:text-slate-400">{u.impact}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Implementation steps</h2>
        {analysis.steps.map((s) => (
          <Card
            key={s.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {CATEGORY_LABELS[s.category] ?? s.title} <RouteBadge route={s.route} />
                <StatusBadge
                  status={
                    s.status === 'resolved'
                      ? 'verified'
                      : s.status === 'needs_input'
                        ? 'unverified'
                        : 'unsupported'
                  }
                  label={
                    s.status === 'resolved'
                      ? 'Resolved'
                      : s.status === 'needs_input'
                        ? 'Needs input'
                        : 'Unsupported'
                  }
                />
              </span>
            }
          >
            <p className="text-sm">{s.detail}</p>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              <span className="font-medium">Why this route:</span> {s.routeRationale}
            </p>
            {s.operationalNotes.map((n) => (
              <p key={n} className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {n}
              </p>
            ))}
            {s.unknownIds.length > 0 && (
              <p className="mt-2 text-sm">
                Open:{' '}
                {s.unknownIds
                  .map((id) => unknown.get(id)?.question)
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </Card>
        ))}
      </div>

      <Card
        title={`Proposed operations (${analysis.operations.length})`}
        description="Automated operations write only to tables discovered on the connected KB. Manual steps are performed by an Agiloft administrator."
      >
        <ol className="space-y-3">
          {analysis.operations.map((o, i) => (
            <li
              key={o.id}
              className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700"
            >
              <div className="flex flex-wrap items-center gap-2 font-medium">
                {i + 1}. {o.title} <RouteBadge route={o.route} />
              </div>
              {o.fields && (
                <div className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-400">
                  {o.table}:{' '}
                  {Object.entries(o.fields)
                    .map(([k, v]) => `${k}=${displayValue(v)}`)
                    .join(', ')}
                </div>
              )}
              {o.manualInstructions && (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {o.manualInstructions.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </Card>

      {analysis.assumptions.length > 0 && (
        <Card title="Assumptions">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {analysis.assumptions.map((x) => (
              <li key={x.id}>
                {x.text}{' '}
                <span className="text-xs text-slate-500 dark:text-slate-400">({x.source})</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`Generated test cases (${analysis.testCases.length})`}>
        <ul className="space-y-2 text-sm">
          {analysis.testCases.map((t) => (
            <li key={t.id}>
              <span className="font-medium">{t.title}.</span> Given {t.given}, when {t.when}, then{' '}
              {t.then}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
