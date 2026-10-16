import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { useConnection } from '../lib/context';
import type { CapabilityRow, CapabilitySummary } from '../lib/types';
import { formatDateTime, humanize } from '../lib/format';
import { PageHeader, SidePanel } from '../components/layout';
import { Callout, Field, Input, KeyValue, Select, TableWrap, Td, Th } from '../components/ui';
import { EmptyState, QueryState } from '../components/states';
import { Badge, StatusBadge } from '../components/status';

interface CapabilityResponse {
  connection: { id: string; name: string; environment: string; mode: string } | null;
  summary: CapabilitySummary;
  capabilities: CapabilityRow[];
  notes: string[];
}

const USE: Record<string, string> = {
  used: 'Used by Agiloft Control',
  not_implemented: 'Documented; not implemented yet',
  blocked_by_policy: 'Disabled by policy',
  not_available: 'Nothing to call – manual route',
};

export function CapabilitiesPage() {
  const { current } = useConnection();
  const q = useQuery({
    queryKey: ['capabilities', current?.id],
    queryFn: () =>
      api<CapabilityResponse>(`/api/capabilities${current ? `?connectionId=${current.id}` : ''}`),
  });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<CapabilityRow | null>(null);
  return (
    <>
      <PageHeader
        title="Capability Explorer"
        crumbs={[{ label: 'Overview', to: '/' }, { label: 'Capability Explorer' }]}
        description="What Agiloft supports according to official documentation, and what has been confirmed on the selected connection."
      />
      <QueryState q={q}>
        {(d) => (
          <Body
            d={d}
            search={search}
            setSearch={setSearch}
            category={category}
            setCategory={setCategory}
            status={status}
            setStatus={setStatus}
            onSelect={setSelected}
          />
        )}
      </QueryState>
      <SidePanel
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={selected?.title ?? ''}
        description={selected?.id}
      >
        {selected && <CapabilityDetail c={selected} />}
      </SidePanel>
    </>
  );
}

function Body(props: {
  d: CapabilityResponse;
  search: string;
  setSearch: (s: string) => void;
  category: string;
  setCategory: (s: string) => void;
  status: string;
  setStatus: (s: string) => void;
  onSelect: (c: CapabilityRow) => void;
}) {
  const { d } = props;
  const rows = useMemo(
    () =>
      d.capabilities.filter(
        (c) =>
          (!props.category || c.category === props.category) &&
          (!props.status || c.docStatus === props.status) &&
          (!props.search ||
            `${c.id} ${c.title} ${c.description}`
              .toLowerCase()
              .includes(props.search.toLowerCase())),
      ),
    [d, props.category, props.status, props.search],
  );
  return (
    <div className="space-y-4">
      {d.notes.map((n) => (
        <Callout key={n}>{n}</Callout>
      ))}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Search">
          {({ id }) => (
            <Input
              id={id}
              value={props.search}
              onChange={(e) => props.setSearch(e.target.value)}
              placeholder="e.g. rules, lock, search"
            />
          )}
        </Field>
        <Field label="Category">
          {({ id }) => (
            <Select
              id={id}
              value={props.category}
              onChange={(e) => props.setCategory(e.target.value)}
            >
              <option value="">All</option>
              {[...new Set(d.capabilities.map((c) => c.category))].map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Documentation status">
          {({ id }) => (
            <Select id={id} value={props.status} onChange={(e) => props.setStatus(e.target.value)}>
              <option value="">All</option>
              {['verified', 'unverified', 'unsupported', 'restricted'].map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400" aria-live="polite">
        Showing {rows.length} of {d.summary.total} capabilities
        {d.connection ? ` · instance results for ${d.connection.name}` : ''}.
      </p>
      {rows.length === 0 ? (
        <EmptyState title="No capabilities match these filters" />
      ) : (
        <TableWrap label="Capabilities">
          <thead>
            <tr>
              <Th>Capability</Th>
              <Th className="hidden md:table-cell">Category</Th>
              <Th className="hidden md:table-cell">Documentation</Th>
              <Th className="hidden md:table-cell">This connection</Th>
              <Th className="hidden lg:table-cell">Agiloft Control</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-900">
                <Td>
                  <button
                    type="button"
                    onClick={() => props.onSelect(c)}
                    className="text-left font-medium text-brand-700 hover:underline dark:text-brand-100"
                  >
                    {c.title}
                  </button>
                  <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{c.id}</div>
                  <div className="mt-1 flex flex-wrap gap-1 md:hidden">
                    <StatusBadge status={c.docStatus} label={`Docs: ${humanize(c.docStatus)}`} />
                    <StatusBadge
                      status={c.instance?.status ?? 'not_checked'}
                      label={`Connection: ${humanize(c.instance?.status ?? 'not_checked')}`}
                    />
                  </div>
                </Td>
                <Td className="hidden md:table-cell">{humanize(c.category)}</Td>
                <Td className="hidden md:table-cell">
                  <StatusBadge status={c.docStatus} />
                </Td>
                <Td className="hidden md:table-cell">
                  <StatusBadge status={c.instance?.status ?? 'not_checked'} />
                  {c.instance?.synthetic && (
                    <div className="mt-1 text-xs text-violet-800 dark:text-violet-300">
                      synthetic (demo)
                    </div>
                  )}
                </Td>
                <Td className="hidden min-w-48 lg:table-cell">{USE[c.productUse]}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}

function CapabilityDetail({ c }: { c: CapabilityRow }) {
  return (
    <div className="space-y-5 text-sm">
      <p>{c.description}</p>
      <KeyValue
        items={[
          ['Documentation', <StatusBadge key="d" status={c.docStatus} />],
          [
            'This connection',
            c.instance ? (
              <span key="i">
                <StatusBadge status={c.instance.status} />{' '}
                <span className="ml-1">{c.instance.detail}</span>
              </span>
            ) : (
              'Not checked'
            ),
          ],
          ['Checked on connection', formatDateTime(c.instance?.checkedAt)],
          ['Agiloft Control', USE[c.productUse]],
          ['Mechanism', c.mechanism ?? 'None'],
          ['Applies to', c.appliesTo],
          [
            'Required permissions',
            c.requiredPermissions.length ? c.requiredPermissions.join('; ') : '—',
          ],
          ['Instance probe', humanize(c.instanceProbe)],
        ]}
      />
      {c.manualAlternative && (
        <Callout tone="warning" title="Manual implementation">
          {c.manualAlternative}
        </Callout>
      )}
      {c.limits.length > 0 && (
        <div>
          <h3 className="font-semibold">Limits</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {c.limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h3 className="font-semibold">Evidence</h3>
        <ul className="mt-2 space-y-3">
          {c.evidence.map((e) => (
            <li
              key={e.url + e.finding}
              className="rounded-md border border-slate-200 p-3 dark:border-slate-700"
            >
              <a
                href={e.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline dark:text-brand-100"
              >
                {e.title} <ExternalLink className="size-3.5" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
              <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                Checked {e.checkedAt}
              </div>
              <p className="mt-1">{e.finding}</p>
            </li>
          ))}
        </ul>
      </div>
      <Badge>
        Documentation verification is not proof that a specific instance behaves this way.
      </Badge>
    </div>
  );
}
