import clsx from 'clsx';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  Clock,
  FlaskConical,
  Hand,
  Loader2,
  MinusCircle,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { Environment } from '../lib/types';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'violet';
const TONES: Record<Tone, string> = {
  neutral:
    'bg-slate-100 text-slate-800 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600',
  info: 'bg-sky-50 text-sky-900 ring-sky-300 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800',
  success:
    'bg-emerald-50 text-emerald-900 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800',
  warning:
    'bg-amber-50 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800',
  danger: 'bg-red-50 text-red-900 ring-red-300 dark:bg-red-950 dark:text-red-200 dark:ring-red-800',
  violet:
    'bg-violet-50 text-violet-900 ring-violet-300 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-800',
};

/** Status is always conveyed by label and icon, never by colour alone. */
export function Badge({
  tone = 'neutral',
  icon: Icon,
  children,
  className,
  spin,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
  spin?: boolean;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {Icon && <Icon className={clsx('size-3.5 shrink-0', spin && 'animate-spin')} aria-hidden />}
      {children}
    </span>
  );
}

const STATUS: Record<string, { tone: Tone; icon: LucideIcon; label: string; spin?: boolean }> = {
  draft: { tone: 'neutral', icon: CircleDashed, label: 'Draft' },
  validated: { tone: 'info', icon: CheckCircle2, label: 'Validated' },
  awaiting_approval: { tone: 'warning', icon: Clock, label: 'Awaiting approval' },
  approved: { tone: 'success', icon: ShieldCheck, label: 'Approved' },
  rejected: { tone: 'danger', icon: XCircle, label: 'Rejected' },
  queued: { tone: 'info', icon: Clock, label: 'Queued' },
  executing: { tone: 'info', icon: Loader2, label: 'Executing', spin: true },
  running: { tone: 'info', icon: Loader2, label: 'Running', spin: true },
  succeeded: { tone: 'success', icon: CheckCircle2, label: 'Succeeded' },
  partially_succeeded: { tone: 'warning', icon: AlertTriangle, label: 'Partially succeeded' },
  failed: { tone: 'danger', icon: XCircle, label: 'Failed' },
  cancelled: { tone: 'neutral', icon: Ban, label: 'Cancelled' },
  pending: { tone: 'neutral', icon: CircleDashed, label: 'Pending' },
  skipped: { tone: 'neutral', icon: MinusCircle, label: 'Skipped' },
  unknown: { tone: 'danger', icon: CircleHelp, label: 'Outcome unknown' },
  manual: { tone: 'violet', icon: Hand, label: 'Manual step' },
  verified: { tone: 'success', icon: CheckCircle2, label: 'Verified' },
  unverified: { tone: 'warning', icon: CircleHelp, label: 'Unverified' },
  unsupported: { tone: 'danger', icon: Ban, label: 'Unsupported' },
  restricted: { tone: 'warning', icon: ShieldAlert, label: 'Restricted' },
  not_checked: { tone: 'neutral', icon: CircleDashed, label: 'Not checked' },
  success: { tone: 'success', icon: CheckCircle2, label: 'Success' },
  denied: { tone: 'warning', icon: ShieldAlert, label: 'Denied' },
  failure: { tone: 'danger', icon: XCircle, label: 'Failure' },
  invalidated: { tone: 'neutral', icon: MinusCircle, label: 'Invalidated' },
  expired: { tone: 'warning', icon: Clock, label: 'Expired' },
  none: { tone: 'neutral', icon: CircleDashed, label: 'None' },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STATUS[status] ?? { tone: 'neutral' as Tone, icon: CircleDashed, label: status };
  return (
    <Badge tone={s.tone} icon={s.icon} spin={s.spin}>
      {label ?? s.label}
    </Badge>
  );
}

const ENV: Record<Environment, { tone: Tone; label: string; icon: LucideIcon; stripe: string }> = {
  demo: { tone: 'violet', label: 'DEMO', icon: FlaskConical, stripe: 'bg-violet-600' },
  development: { tone: 'info', label: 'DEVELOPMENT', icon: Wrench, stripe: 'bg-sky-600' },
  staging: { tone: 'warning', label: 'STAGING', icon: AlertTriangle, stripe: 'bg-amber-500' },
  production: { tone: 'danger', label: 'PRODUCTION', icon: ShieldAlert, stripe: 'bg-red-600' },
};

export function EnvironmentBadge({ env, className }: { env: Environment; className?: string }) {
  const e = ENV[env];
  return (
    <Badge tone={e.tone} icon={e.icon} className={clsx('font-semibold tracking-wide', className)}>
      {e.label}
    </Badge>
  );
}
export const envStripe = (env: Environment | undefined) => (env ? ENV[env].stripe : 'bg-slate-300');

const ROUTES: Record<string, { tone: Tone; label: string }> = {
  native_existing: { tone: 'info', label: 'Existing native configuration' },
  config_records: { tone: 'success', label: 'Configuration records (automated)' },
  admin_api: { tone: 'warning', label: 'Administration API' },
  external_orchestration: { tone: 'warning', label: 'External orchestration' },
  manual_admin: { tone: 'violet', label: 'Manual administrator step' },
  unsupported: { tone: 'danger', label: 'Unsupported / awaiting verification' },
};
export function RouteBadge({ route }: { route: string }) {
  const r = ROUTES[route] ?? { tone: 'neutral' as Tone, label: route };
  return <Badge tone={r.tone}>{r.label}</Badge>;
}
