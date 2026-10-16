import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Tabs from '@radix-ui/react-tabs';
import { api, ApiError, patch, put } from '../lib/api';
import { useAnnounce, useSession } from '../lib/context';
import type { Environment, Policy } from '../lib/types';
import { formatDateTime } from '../lib/format';
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
import { ErrorState, QueryState } from '../components/states';
import { EnvironmentBadge, StatusBadge } from '../components/status';

interface SystemInfo {
  authMode: string;
  demoMode: boolean;
  database: string;
  encryptionKey: string;
  modelProvider: string;
  auditRetentionDays: number;
  allowedHostSuffixes: string[];
  onPremHosts: string[];
  mcp: { stdioCommand: string; httpUrl: string; httpAuth: string };
  identityModel: string;
}

const TABS = [
  ['policies', 'Environment policies'],
  ['access', 'Access control'],
  ['mcp', 'MCP connection'],
  ['system', 'System and health'],
] as const;

export function SettingsPage() {
  const [tab, setTab] = useState<string>('policies');
  return (
    <>
      <PageHeader
        title="Settings"
        crumbs={[{ label: 'Overview', to: '/' }, { label: 'Settings' }]}
        description="Environment policies, roles, MCP connection details and application health."
      />
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List
          aria-label="Settings sections"
          className="mb-6 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
        >
          {TABS.map(([v, l]) => (
            <Tabs.Trigger
              key={v}
              value={v}
              className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 data-[state=active]:border-brand-700 data-[state=active]:text-brand-800 dark:text-slate-400 dark:hover:text-slate-100 dark:data-[state=active]:text-brand-100"
            >
              {l}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="policies">
          <Policies />
        </Tabs.Content>
        <Tabs.Content value="access">
          <Access />
        </Tabs.Content>
        <Tabs.Content value="mcp">
          <Mcp />
        </Tabs.Content>
        <Tabs.Content value="system">
          <System />
        </Tabs.Content>
      </Tabs.Root>
    </>
  );
}

function Policies() {
  const q = useQuery({
    queryKey: ['policies'],
    queryFn: () => api<Policy[]>('/api/settings/policies'),
  });
  return (
    <QueryState q={q}>
      {(list) => (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {list.map((p) => (
            <PolicyCard key={p.environment} p={p} />
          ))}
        </div>
      )}
    </QueryState>
  );
}

function PolicyCard({ p }: { p: Policy }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const announce = useAnnounce();
  const editable = can('settings:manage', p.environment);
  const m = useMutation({
    mutationFn: (body: Partial<Policy>) =>
      patch<Policy>(`/api/settings/policies/${p.environment}`, body),
    onSuccess: () => (
      void qc.invalidateQueries({ queryKey: ['policies'] }),
      announce(`${p.environment} policy updated.`, 'success')
    ),
    onError: (e) => announce(e instanceof ApiError ? e.message : 'Update failed.', 'error'),
  });
  const toggle = (
    key: 'writesEnabled' | 'requireSeparationOfDuties' | 'useRecordLocks',
    label: string,
    help: string,
  ) => (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        role="switch"
        aria-checked={p[key]}
        className="mt-0.5 size-4 accent-brand-700"
        checked={p[key]}
        disabled={!editable || m.isPending}
        onChange={(e) => {
          if (
            key === 'writesEnabled' &&
            e.target.checked &&
            p.environment === 'production' &&
            !window.confirm('Enable writes to PRODUCTION? Approved plans will change live data.')
          )
            return;
          m.mutate({ [key]: e.target.checked });
        }}
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-slate-600 dark:text-slate-400">{help}</span>
      </span>
    </label>
  );
  return (
    <Card
      title={<EnvironmentBadge env={p.environment as Environment} />}
      description={`Updated ${formatDateTime(p.updatedAt)}`}
    >
      <div className="space-y-4">
        {toggle(
          'writesEnabled',
          'Writes enabled',
          'When off, plans with record writes cannot be validated or executed in this environment.',
        )}
        {toggle(
          'requireSeparationOfDuties',
          'Separation of duties',
          'The plan creator or submitter cannot approve it.',
        )}
        {toggle(
          'useRecordLocks',
          'Lock records during updates',
          'Use Agiloft record locks (EWLock) while an update is written.',
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(new FormData(e.currentTarget).get('ttl'));
            m.mutate({ approvalTtlMinutes: v });
          }}
        >
          <Field
            label="Approval validity (minutes)"
            hint="Approvals expire after this; execution then requires a fresh approval."
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="ttl"
                type="number"
                min={5}
                max={10080}
                defaultValue={p.approvalTtlMinutes}
                disabled={!editable}
                aria-describedby={describedBy}
                className="w-36"
              />
            )}
          </Field>
          {editable && (
            <Button type="submit" size="sm">
              Save
            </Button>
          )}
        </form>
        {!editable && (
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Read-only: requires the administrator role.
          </p>
        )}
      </div>
    </Card>
  );
}

function Access() {
  const { can } = useSession();
  const qc = useQueryClient();
  const announce = useAnnounce();
  const q = useQuery({
    queryKey: ['users'],
    queryFn: () =>
      api<
        {
          id: string;
          email: string;
          displayName: string;
          disabled: boolean;
          roles: { role: string; environment: string }[];
        }[]
      >('/api/settings/users'),
    enabled: can('users:manage'),
  });
  const save = useMutation({
    mutationFn: ({ id, roles }: { id: string; roles: { role: string; environment: string }[] }) =>
      put(`/api/settings/users/${id}/roles`, { roles }),
    onSuccess: () => (
      void qc.invalidateQueries({ queryKey: ['users'] }),
      announce('Roles updated.', 'success')
    ),
    onError: (e) => announce(e instanceof ApiError ? e.message : 'Update failed.', 'error'),
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (!can('users:manage'))
    return (
      <ErrorState
        error={
          new ApiError(403, 'FORBIDDEN', 'Managing users requires the global administrator role.')
        }
      />
    );
  return (
    <div className="space-y-4">
      <Callout>
        Roles are enforced on the server. Viewer: read. Operator: prepare and execute plans.
        Approver: approve or reject plans (never via MCP). Administrator: connections, policies and
        users. Roles can be global (*) or limited to one environment.
      </Callout>
      <QueryState q={q}>
        {(users) => (
          <TableWrap label="Users and roles">
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Roles</Th>
                <Th>Add role</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {users.map((u) => (
                <tr key={u.id}>
                  <Td>
                    <div className="font-medium">{u.displayName}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{u.email}</div>
                  </Td>
                  <Td>
                    <ul className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <li key={r.role + r.environment}>
                          <button
                            type="button"
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs hover:bg-red-100 dark:bg-slate-800 dark:hover:bg-red-950"
                            aria-label={`Remove ${r.role} (${r.environment}) from ${u.displayName}`}
                            onClick={() =>
                              save.mutate({ id: u.id, roles: u.roles.filter((x) => x !== r) })
                            }
                          >
                            {r.role} · {r.environment} ✕
                          </button>
                        </li>
                      ))}
                      {u.roles.length === 0 && (
                        <span className="text-xs text-slate-500">No roles</span>
                      )}
                    </ul>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <Select
                        aria-label={`Role for ${u.displayName}`}
                        className="h-8 w-auto"
                        value={draft[`${u.id}:role`] ?? 'viewer'}
                        onChange={(e) => setDraft({ ...draft, [`${u.id}:role`]: e.target.value })}
                      >
                        {['viewer', 'operator', 'approver', 'admin'].map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </Select>
                      <Select
                        aria-label={`Environment for ${u.displayName}`}
                        className="h-8 w-auto"
                        value={draft[`${u.id}:env`] ?? '*'}
                        onChange={(e) => setDraft({ ...draft, [`${u.id}:env`]: e.target.value })}
                      >
                        {['*', 'demo', 'development', 'staging', 'production'].map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        onClick={() =>
                          save.mutate({
                            id: u.id,
                            roles: [
                              ...u.roles,
                              {
                                role: draft[`${u.id}:role`] ?? 'viewer',
                                environment: draft[`${u.id}:env`] ?? '*',
                              },
                            ],
                          })
                        }
                      >
                        Add
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </QueryState>
    </div>
  );
}

function useSystem() {
  return useQuery({ queryKey: ['system'], queryFn: () => api<SystemInfo>('/api/settings/system') });
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
      {children}
    </pre>
  );
}

function Mcp() {
  const q = useSystem();
  return (
    <QueryState q={q}>
      {(s) => (
        <div className="space-y-6">
          <Card
            title="Local (stdio)"
            description="The MCP host launches Agiloft Control as a child process. It acts as the Agiloft Control user named by MCP_STDIO_USER_EMAIL and is subject to that user's roles."
          >
            <Code>
              {JSON.stringify(
                {
                  mcpServers: {
                    'agiloft-control': {
                      command: 'node',
                      args: ['/path/to/agiloft-mcp/apps/mcp-server/dist/stdio.js'],
                      env: {
                        DATABASE_URL: 'postgres://…',
                        APP_ENCRYPTION_KEY: '<same key as the console>',
                        MCP_STDIO_USER_EMAIL: 'you@example.com',
                      },
                    },
                  },
                },
                null,
                2,
              )}
            </Code>
          </Card>
          <Card
            title="Remote (Streamable HTTP)"
            description="OAuth 2.1 bearer tokens from your identity provider; token audience must be this resource URL."
          >
            <KeyValue
              items={[
                ['Endpoint', <code key="u">{s.mcp.httpUrl}</code>],
                ['Authentication', s.mcp.httpAuth],
                ['Scopes', 'agiloft:read, agiloft:plan, agiloft:execute, agiloft:audit'],
                ['Approval', 'Never available via MCP. Approvers decide in this console.'],
              ]}
            />
          </Card>
        </div>
      )}
    </QueryState>
  );
}

function System() {
  const q = useSystem();
  const ready = useQuery({
    queryKey: ['readyz'],
    queryFn: () =>
      fetch('/readyz').then(
        (r) => r.json() as Promise<{ ok: boolean; checks: Record<string, string> }>,
      ),
    refetchInterval: 15_000,
  });
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card title="Configuration">
        <QueryState q={q}>
          {(s) => (
            <>
              {s.encryptionKey.startsWith('EPHEMERAL') && (
                <div className="mb-4">
                  <Callout tone="warning">{s.encryptionKey}</Callout>
                </div>
              )}
              <KeyValue
                items={[
                  [
                    'Authentication',
                    s.authMode === 'dev' ? 'Development login (non-production only)' : 'OIDC',
                  ],
                  ['Demo mode', s.demoMode ? 'On' : 'Off'],
                  ['Database', s.database],
                  ['Credential encryption', s.encryptionKey],
                  ['Model provider', s.modelProvider],
                  ['Audit retention', `${s.auditRetentionDays} days`],
                  ['Allowed Agiloft domains', s.allowedHostSuffixes.join(', ') || '—'],
                  ['Approved on-premises hosts', s.onPremHosts.join(', ') || '—'],
                  ['Identity in Agiloft', s.identityModel],
                ]}
              />
            </>
          )}
        </QueryState>
      </Card>
      <Card title="Health">
        <QueryState q={ready}>
          {(r) => (
            <ul className="space-y-2 text-sm">
              <li>
                <StatusBadge
                  status={r.ok ? 'verified' : 'failure'}
                  label={r.ok ? 'Ready' : 'Not ready'}
                />
              </li>
              {Object.entries(r.checks).map(([k, v]) => (
                <li key={k}>
                  <span className="font-medium capitalize">{k}:</span> {v}
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Card>
    </div>
  );
}
