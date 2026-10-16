import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { AlertOctagon, Inbox, Lock, PlugZap, SearchX } from 'lucide-react';
import { ApiError } from '../lib/api';
import { Button, Skeleton } from './ui';

function Shell({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 px-6 py-10 text-center dark:border-slate-700"
      role="status"
    >
      <div className="text-slate-500 dark:text-slate-400" aria-hidden>
        {icon}
      </div>
      <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      {children && (
        <div className="mt-1 max-w-prose text-sm text-slate-600 dark:text-slate-400">
          {children}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const LoadingState = ({
  label = 'Loading…',
  rows = 4,
}: {
  label?: string;
  rows?: number;
}) => (
  <div role="status" aria-live="polite" className="space-y-3">
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }).map((_, i) => (
      <Skeleton key={i} className="h-10 w-full" />
    ))}
  </div>
);

export const EmptyState = ({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) => (
  <Shell icon={<Inbox className="size-8" />} title={title} action={action}>
    {children}
  </Shell>
);

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  if (e?.kind === 'forbidden') {
    return (
      <Shell icon={<Lock className="size-8" />} title="You do not have access">
        {e.message} Ask an administrator if you need this permission.
      </Shell>
    );
  }
  if (e?.kind === 'not_found') {
    return (
      <Shell
        icon={<SearchX className="size-8" />}
        title="Not found"
        action={
          <Link className="text-sm font-medium text-brand-700 underline dark:text-brand-100" to="/">
            Go to overview
          </Link>
        }
      >
        {e.message}
      </Shell>
    );
  }
  if (e?.kind === 'disconnected') {
    return (
      <Shell
        icon={<PlugZap className="size-8" />}
        title="Disconnected"
        action={retry && <Button onClick={retry}>Try again</Button>}
      >
        {e.message} No demo data is substituted for a failed live connection.
      </Shell>
    );
  }
  return (
    <Shell
      icon={<AlertOctagon className="size-8" />}
      title="Something went wrong"
      action={retry && <Button onClick={retry}>Try again</Button>}
    >
      <span>{e?.message ?? 'An unexpected error occurred.'}</span>
      {e?.correlationId && (
        <span className="mt-1 block font-mono text-xs">Correlation ID: {e.correlationId}</span>
      )}
    </Shell>
  );
}

/** Renders loading, error (incl. permission-denied and disconnected) or content. */
export function QueryState<T>({
  q,
  children,
  empty,
  isEmpty,
}: {
  q: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown };
  children: (data: T) => ReactNode;
  empty?: ReactNode;
  isEmpty?: (d: T) => boolean;
}) {
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  if (q.data === undefined) return null;
  if (empty && isEmpty?.(q.data)) return <>{empty}</>;
  return <>{children(q.data)}</>;
}

export function NoConnection() {
  return (
    <EmptyState
      title="No connection available"
      action={
        <Link
          className="text-sm font-medium text-brand-700 underline dark:text-brand-100"
          to="/connections"
        >
          Open Connections
        </Link>
      }
    >
      You have no connection you are allowed to use. An administrator can create one or grant you
      access.
    </EmptyState>
  );
}
