import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, KeyRound, Plus, RefreshCw } from 'lucide-react';
import { api, ApiError, del, post } from '../lib/api';
import { useAnnounce, useConnection, useSession } from '../lib/context';
import type { Connection, Environment } from '../lib/types';
import { formatDateTime, formatRelative } from '../lib/format';
import { PageHeader } from '../components/layout';
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
import { EmptyState, QueryState } from '../components/states';
import { EnvironmentBadge, StatusBadge } from '../components/status';

export function ConnectionsPage() {
  const q = useQuery({
    queryKey: ['connections'],
    queryFn: () => api<Connection[]>('/api/connections'),
  });
  const { can } = useSession();
  const [creating, setCreating] = useState(false);
  const canCreate = (['development', 'staging', 'production'] as Environment[]).some((e) =>
    can('connections:manage', e),
  );
  return (
    <>
      <PageHeader
        title="Connections"
        crumbs={[{ label: 'Overview', to: '/' }, { label: 'Connections' }]}
        description="Agiloft knowledge bases this workspace can reach. Credentials are encrypted on the server and can never be read back in the browser."
        actions={
          canCreate && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => setCreating((c) => !c)}
              aria-expanded={creating}
            >
              New connection
            </Button>
          )
        }
      />
      {creating && <NewConnectionForm onDone={() => setCreating(false)} />}
      <QueryState
        q={q}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState title="No connections">
            An administrator can add a live connection.
          </EmptyState>
        }
      >
        {(list) => (
          <div className="space-y-6">
            {list.map((c) => (
              <ConnectionCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </QueryState>
    </>
  );
}

function ConnectionCard({ c }: { c: Connection }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const announce = useAnnounce();
  const [showResults, setShowResults] = useState(false);
  const test = useMutation({
    mutationFn: () => post<{ ok: boolean; summary: string }>(`/api/connections/${c.id}/test`),
    onSuccess: (r) => {
      announce(
        `Verification ${r.ok ? 'succeeded' : 'reported problems'}: ${r.summary}`,
        r.ok ? 'success' : 'error',
      );
      void qc.invalidateQueries({ queryKey: ['connections'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (e) => announce(e instanceof ApiError ? e.message : 'Verification failed.', 'error'),
  });
  const v = c.lastVerification;
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {c.name} <EnvironmentBadge env={c.environment} />
          {c.mode === 'demo' && <StatusBadge status="manual" label="Demo adapter" />}
          {c.disabled && <StatusBadge status="cancelled" label="Disabled" />}
        </span>
      }
      description={c.identityNote}
      actions={
        can('capabilities:verify', c.environment) && (
          <Button
            size="sm"
            onClick={() => test.mutate()}
            busy={test.isPending}
            icon={<RefreshCw className="size-4" aria-hidden />}
          >
            Test connection (read-only)
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <KeyValue
          items={[
            [
              'Mode',
              c.mode === 'demo' ? 'Demo adapter (synthetic data, no network)' : 'Live Agiloft REST',
            ],
            ['Base URL', c.baseUrl ?? '—'],
            ['Knowledge base', c.kbName],
            ['Language', c.lang],
            [
              'Authentication',
              c.authMethod === 'none'
                ? 'None (demo)'
                : c.authMethod === 'password_jwt'
                  ? 'Login token (EWLogin)'
                  : 'OAuth 2.0 client credentials',
            ],
            [
              'Credentials',
              c.credentialsStored ? (
                <span className="inline-flex items-center gap-1">
                  <KeyRound className="size-4" aria-hidden /> Stored encrypted for{' '}
                  {c.principalHint ?? 'integration user'}. Not retrievable.
                </span>
              ) : (
                'None'
              ),
            ],
          ]}
        />
        <div>
          <h3 className="text-sm font-semibold">Most recent verification</h3>
          {v ? (
            <div className="mt-2 space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={v.ok ? 'verified' : 'failure'}
                  label={v.ok ? 'Passed' : 'Problems found'}
                />
                <span className="text-slate-600 dark:text-slate-400">
                  {formatDateTime(v.checkedAt)} ({formatRelative(v.checkedAt)})
                </span>
              </div>
              <p>{v.summary}</p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowResults((s) => !s)}
                aria-expanded={showResults}
              >
                {showResults ? 'Hide' : 'Show'} {v.results.length} capability results
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Not yet verified.</p>
          )}
        </div>
      </div>
      {showResults && v && (
        <div className="mt-4">
          <TableWrap label="Verification results">
            <thead>
              <tr>
                <Th>Capability</Th>
                <Th>Result</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {v.results.map((r) => (
                <tr key={r.capabilityId}>
                  <Td className="font-mono text-xs">{r.capabilityId}</Td>
                  <Td>
                    <StatusBadge status={r.status} />
                    {r.synthetic && (
                      <span className="ml-1 text-xs text-violet-800 dark:text-violet-300">
                        synthetic
                      </span>
                    )}
                  </Td>
                  <Td>{r.detail}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      )}
      {c.mode === 'demo' && can('demo:control', c.environment) && (
        <DemoControls connectionId={c.id} />
      )}
    </Card>
  );
}

function NewConnectionForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const announce = useAnnounce();
  const { can } = useSession();
  const { setCurrentId } = useConnection();
  const [method, setMethod] = useState<'password_jwt' | 'oauth_client_credentials'>(
    'oauth_client_credentials',
  );
  const [error, setError] = useState<ApiError | null>(null);
  const create = useMutation({
    mutationFn: (body: unknown) => post<Connection>('/api/connections', body),
    onSuccess: (c) => {
      announce(
        `Connection "${c.name}" saved. Credentials are encrypted and will not be shown again.`,
        'success',
      );
      void qc.invalidateQueries({ queryKey: ['connections'] });
      setCurrentId(c.id);
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e : null),
  });
  const envs = (['development', 'staging', 'production'] as Environment[]).filter((e) =>
    can('connections:manage', e),
  );

  function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setError(null);
    const f = new FormData(ev.currentTarget);
    const auth =
      method === 'password_jwt'
        ? { method, login: String(f.get('login') ?? ''), password: String(f.get('password') ?? '') }
        : {
            method,
            clientId: String(f.get('clientId') ?? ''),
            clientSecret: String(f.get('clientSecret') ?? ''),
          };
    create.mutate({
      name: f.get('name'),
      environment: f.get('environment'),
      baseUrl: f.get('baseUrl'),
      kbName: f.get('kbName'),
      lang: f.get('lang') || 'en',
      auth,
    });
    // Clear secret inputs immediately; they are never kept in client state.
    ev.currentTarget
      .querySelectorAll<HTMLInputElement>('input[type=password]')
      .forEach((i) => (i.value = ''));
  }

  return (
    <Card
      title="New live connection"
      className="mb-6"
      description="Use a least-privilege integration account in a REST-enabled group. Writes stay disabled until an administrator enables them for the environment."
    >
      <form
        onSubmit={submit}
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
        autoComplete="off"
        noValidate
      >
        <Field label="Name" required>
          {({ id, describedBy }) => (
            <Input id={id} name="name" required maxLength={80} aria-describedby={describedBy} />
          )}
        </Field>
        <Field
          label="Environment"
          required
          hint="Production connections show a persistent warning banner."
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              name="environment"
              required
              aria-describedby={describedBy}
              defaultValue={envs[0]}
            >
              {envs.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Base URL"
          required
          hint="HTTPS only. Host must be an approved Agiloft domain or an approved on-premises host."
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              name="baseUrl"
              type="url"
              required
              placeholder="https://yourcompany.agiloft.com"
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field label="Knowledge base name" required hint="Case-sensitive KB name.">
          {({ id, describedBy }) => (
            <Input id={id} name="kbName" required aria-describedby={describedBy} />
          )}
        </Field>
        <Field label="Language code" hint="Two letters, e.g. en.">
          {({ id, describedBy }) => (
            <Input
              id={id}
              name="lang"
              defaultValue="en"
              maxLength={2}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Authentication</legend>
          {(
            [
              ['oauth_client_credentials', 'OAuth 2.0 client credentials (recommended)'],
              ['password_jwt', 'Integration user login token (EWLogin)'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="method"
                value={value}
                checked={method === value}
                onChange={() => setMethod(value)}
                className="size-4 accent-brand-700"
              />
              {label}
            </label>
          ))}
        </fieldset>
        {method === 'password_jwt' ? (
          <>
            <Field label="Login" required>
              {({ id }) => <Input id={id} name="login" required autoComplete="off" />}
            </Field>
            <Field label="Password" required>
              {({ id }) => (
                <Input
                  id={id}
                  name="password"
                  type="password"
                  required
                  autoComplete="new-password"
                />
              )}
            </Field>
          </>
        ) : (
          <>
            <Field label="Client ID" required>
              {({ id }) => <Input id={id} name="clientId" required autoComplete="off" />}
            </Field>
            <Field label="Client secret" required>
              {({ id }) => (
                <Input
                  id={id}
                  name="clientSecret"
                  type="password"
                  required
                  autoComplete="new-password"
                />
              )}
            </Field>
          </>
        )}
        {error && (
          <div className="md:col-span-2">
            <Callout tone="danger" title="Connection not saved">
              {error.message}
              {Array.isArray(error.details?.issues) && (
                <ul className="mt-1 list-disc pl-5">
                  {(error.details!.issues as string[]).map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              )}
            </Callout>
          </div>
        )}
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" variant="primary" busy={create.isPending}>
            Save connection
          </Button>
          <Button onClick={onDone}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

const FAULTS = [
  ['reject_next_write', 'Next write is rejected by a validation rule'],
  ['lose_response_after_apply', 'Next write is applied but the response is lost (ambiguous)'],
  ['timeout_before_apply', 'Next write times out before reaching Agiloft'],
] as const;

function DemoControls({ connectionId }: { connectionId: string }) {
  const qc = useQueryClient();
  const announce = useAnnounce();
  const { can } = useSession();
  const state = useQuery({
    queryKey: ['demo', connectionId],
    queryFn: () =>
      api<{
        faults: { id: string; kind: string; table: string | null; operation: string | null }[];
      }>(`/api/connections/${connectionId}/demo`),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['demo', connectionId] });
  const onErr = (e: unknown) =>
    announce(e instanceof ApiError ? e.message : 'Action failed.', 'error');
  const addFault = useMutation({
    mutationFn: (b: unknown) => post(`/api/connections/${connectionId}/demo/faults`, b),
    onSuccess: () => (refresh(), announce('Fault armed for the next matching write.', 'success')),
    onError: onErr,
  });
  const clear = useMutation({
    mutationFn: () => del(`/api/connections/${connectionId}/demo/faults`),
    onSuccess: () => (refresh(), announce('Faults cleared.', 'success')),
    onError: onErr,
  });
  const edit = useMutation({
    mutationFn: (b: unknown) => post(`/api/connections/${connectionId}/demo/external-edit`, b),
    onSuccess: () => (
      void qc.invalidateQueries(),
      announce(
        'Record changed as if by another Agiloft user. Plans prepared earlier for it are now stale.',
        'success',
      )
    ),
    onError: onErr,
  });
  const reset = useMutation({
    mutationFn: () => post(`/api/connections/${connectionId}/demo/reset`),
    onSuccess: () => (void qc.invalidateQueries(), announce('Demo data reset.', 'success')),
    onError: onErr,
  });

  return (
    <div className="mt-6 rounded-md border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900 dark:bg-violet-950/30">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-violet-950 dark:text-violet-100">
        <FlaskConical className="size-4" aria-hidden /> Demo controls (demo connection only)
      </h3>
      <p className="mt-1 text-sm text-violet-950/80 dark:text-violet-200/80">
        Simulate failures at the adapter boundary. Everything above the adapter runs exactly as in
        live mode.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            addFault.mutate({
              kind: f.get('kind'),
              table: f.get('table') || null,
              operation: f.get('operation') || null,
            });
          }}
        >
          <Field label="Inject a fault">
            {({ id }) => (
              <Select id={id} name="kind">
                {FAULTS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Table (optional)">
              {({ id }) => <Input id={id} name="table" placeholder="task_templates" />}
            </Field>
            <Field label="Operation">
              {({ id }) => (
                <Select id={id} name="operation">
                  <option value="">Any</option>
                  <option value="create">Create</option>
                  <option value="update">Update</option>
                </Select>
              )}
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" busy={addFault.isPending}>
              Arm fault
            </Button>
            <Button size="sm" variant="ghost" onClick={() => clear.mutate()}>
              Clear faults
            </Button>
          </div>
          <p className="text-sm">
            Armed:{' '}
            {state.data?.faults.length
              ? state.data.faults
                  .map((f) => `${f.kind}${f.table ? ` on ${f.table}` : ''}`)
                  .join('; ')
              : 'none'}
          </p>
        </form>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            edit.mutate({
              table: f.get('table'),
              recordId: f.get('recordId'),
              fields: { [String(f.get('field'))]: f.get('value') },
            });
          }}
        >
          <p className="text-sm font-medium">
            Simulate an external edit (another Agiloft user changes a record)
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Table">
              {({ id }) => <Input id={id} name="table" defaultValue="laptop_requests" required />}
            </Field>
            <Field label="Record ID">
              {({ id }) => (
                <Input id={id} name="recordId" defaultValue="304" required inputMode="numeric" />
              )}
            </Field>
            <Field label="Field">
              {({ id }) => <Input id={id} name="field" defaultValue="status" required />}
            </Field>
            <Field label="New value">
              {({ id }) => <Input id={id} name="value" defaultValue="Rejected" required />}
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" busy={edit.isPending}>
              Apply external edit
            </Button>
            {can('settings:manage', 'demo') && (
              <Button
                size="sm"
                variant="danger"
                busy={reset.isPending}
                onClick={() =>
                  window.confirm('Reset all demo records to their seeded state?') && reset.mutate()
                }
              >
                Reset demo data
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
