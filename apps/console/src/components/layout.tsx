import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import clsx from 'clsx';
import {
  Activity,
  Boxes,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Database,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Plug,
  ScrollText,
  Settings,
  Sparkles,
  Sun,
  Table2,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { post } from '../lib/api';
import { useConnection, useSession, useTheme } from '../lib/context';
import { EnvironmentBadge, envStripe, StatusBadge } from './status';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/connections', label: 'Connections', icon: Plug },
  { to: '/capabilities', label: 'Capability Explorer', icon: Boxes },
  { to: '/schema', label: 'Schema Explorer', icon: Database },
  { to: '/records', label: 'Records', icon: Table2 },
  { to: '/scenario', label: 'Scenario Builder', icon: Sparkles },
  { to: '/plans', label: 'Change Plans', icon: ClipboardList },
  { to: '/approvals', label: 'Approvals', icon: CheckSquare },
  { to: '/executions', label: 'Executions', icon: Activity },
  { to: '/audit', label: 'Audit Log', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function NavItems({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <li key={to}>
          <NavLink
            to={to}
            end={end}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                isActive
                  ? 'bg-brand-50 text-brand-800 dark:bg-brand-800/30 dark:text-brand-100'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                collapsed && 'justify-center px-2',
              )
            }
          >
            <Icon className="size-4.5 shrink-0" aria-hidden />
            <span className={clsx(collapsed && 'sr-only')}>{label}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link
      to="/"
      className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100"
    >
      <img src="/favicon.svg" alt="" className="size-7" />
      <span className={clsx(collapsed && 'sr-only')}>Agiloft Control</span>
    </Link>
  );
}

function AccountMenu() {
  const { me } = useSession();
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  if (!me) return null;
  const initials = me.displayName
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2);
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <span
            className="grid size-8 place-items-center rounded-full bg-brand-700 text-xs font-semibold text-white"
            aria-hidden
          >
            {initials}
          </span>
          <span className="sr-only text-left text-sm lg:not-sr-only lg:block">
            <span className="sr-only">Account menu: </span>
            <span className="block font-medium leading-tight">{me.displayName}</span>
            <span className="block text-xs leading-tight text-slate-600 dark:text-slate-400">
              {[...new Set(me.roles.map((r) => r.role))].join(', ')}
            </span>
          </span>
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-56 rounded-md border border-slate-200 bg-white p-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="px-3 py-2">
            <div className="font-medium">{me.displayName}</div>
            <div className="text-xs text-slate-600 dark:text-slate-400">{me.email}</div>
          </div>
          <Menu.Separator className="my-1 h-px bg-slate-200 dark:bg-slate-700" />
          <Menu.Item
            onSelect={toggle}
            className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 outline-none data-[highlighted]:bg-slate-100 dark:data-[highlighted]:bg-slate-800"
          >
            {theme === 'dark' ? (
              <Sun className="size-4" aria-hidden />
            ) : (
              <Moon className="size-4" aria-hidden />
            )}
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </Menu.Item>
          <Menu.Item
            onSelect={async () => {
              await post('/api/auth/logout');
              await qc.invalidateQueries();
              window.location.assign('/login');
            }}
            className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 outline-none data-[highlighted]:bg-slate-100 dark:data-[highlighted]:bg-slate-800"
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function ConnectionSwitcher() {
  const { connections, current, setCurrentId } = useConnection();
  if (!current)
    return <span className="text-sm text-slate-600 dark:text-slate-400">No connection</span>;
  const v = current.lastVerification;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor="connection-switcher" className="sr-only">
        Active connection
      </label>
      <select
        id="connection-switcher"
        value={current.id}
        onChange={(e) => setCurrentId(e.target.value)}
        className="h-9 max-w-44 truncate rounded-md border border-slate-300 bg-white px-2 text-sm sm:max-w-64 dark:border-slate-600 dark:bg-slate-950"
      >
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.environment})
          </option>
        ))}
      </select>
      <span className="hidden md:inline-flex">
        <StatusBadge
          status={v ? (v.ok ? 'verified' : 'failure') : 'not_checked'}
          label={v ? (v.ok ? 'Connected' : 'Connection problem') : 'Not verified'}
        />
      </span>
    </div>
  );
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('agiloft-control.nav') === 'collapsed';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const { current } = useConnection();
  const location = useLocation();
  useEffect(() => {
    try {
      localStorage.setItem('agiloft-control.nav', collapsed ? 'collapsed' : 'expanded');
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  // After client-side navigation (not the initial load), move focus to the
  // page heading so screen-reader and keyboard users land on the new content.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const h = document.querySelector<HTMLElement>('main h1');
    h?.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow dark:focus:bg-slate-900"
      >
        Skip to content
      </a>
      <aside
        className={clsx(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200 bg-white lg:flex dark:border-slate-800 dark:bg-slate-900',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div
          className={clsx(
            'flex h-14 items-center border-b border-slate-200 px-4 dark:border-slate-800',
            collapsed && 'justify-center px-2',
          )}
        >
          <Brand collapsed={collapsed} />
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto p-2">
          <NavItems collapsed={collapsed} />
        </nav>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex h-10 items-center justify-center gap-2 border-t border-slate-200 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {collapsed ? (
            <ChevronRight className="size-4" aria-hidden />
          ) : (
            <ChevronLeft className="size-4" aria-hidden />
          )}
          {!collapsed && 'Collapse'}
        </button>
      </aside>

      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden" />
          <Dialog.Content
            className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] overflow-y-auto bg-white p-3 shadow-xl lg:hidden dark:bg-slate-900"
            aria-describedby={undefined}
          >
            <div className="mb-3 flex items-center justify-between px-2">
              <Dialog.Title asChild>
                <div>
                  <Brand />
                </div>
              </Dialog.Title>
              <Dialog.Close
                className="rounded p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close navigation"
              >
                <X className="size-5" aria-hidden />
              </Dialog.Close>
            </div>
            <nav aria-label="Main">
              <NavItems collapsed={false} onNavigate={() => setMobileOpen(false)} />
            </nav>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className={clsx('h-1', envStripe(current?.environment))} aria-hidden />
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:gap-3 sm:px-4 dark:border-slate-800 dark:bg-slate-900/95">
          <button
            type="button"
            className="rounded p-2 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <MenuIcon className="size-5" aria-hidden />
          </button>
          <span className="hidden text-sm font-medium text-slate-700 xl:inline dark:text-slate-300">
            Workspace: Agiloft Control
          </span>
          {current && <EnvironmentBadge env={current.environment} />}
          <div className="min-w-0 flex-1">
            <ConnectionSwitcher />
          </div>
          <AccountMenu />
        </header>
        {current?.mode === 'demo' && (
          <div className="border-b border-violet-200 bg-violet-50 px-4 py-1.5 text-center text-xs font-medium text-violet-900 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-200">
            Demo connection: synthetic data from the demo adapter. No real Agiloft instance is
            contacted.
          </div>
        )}
        {current?.environment === 'production' && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-1.5 text-center text-xs font-semibold text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            PRODUCTION connection. Approved plans change live business data.
          </div>
        )}
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  crumbs,
  actions,
}: {
  title: string;
  description?: ReactNode;
  crumbs?: { label: string; to?: string }[];
  actions?: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · Agiloft Control`;
  }, [title]);
  return (
    <div className="mb-6">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
            {crumbs.map((c, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3.5" aria-hidden />}
                {c.to ? (
                  <Link to={c.to} className="hover:underline">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page">{c.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight text-slate-900 outline-none dark:text-slate-50"
          >
            {title}
          </h1>
          {description && (
            <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Right-hand side panel for details (records, capabilities). */
export function SidePanel({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/30" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-white shadow-xl dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-lg font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-sm text-slate-600 dark:text-slate-400">
                  {description}
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">Details</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              className="rounded p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Close panel"
            >
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
