import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setCsrfToken } from './api';
import type { Connection, Environment, Me, Session } from './types';

// ------------------------------------------------------------------ session
interface SessionCtx {
  session: Session | undefined;
  loading: boolean;
  me: Me | null;
  can: (permission: string, env?: Environment) => boolean;
  refresh: () => Promise<void>;
}
const SessionContext = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['session'],
    queryFn: () => api<Session>('/api/session'),
    staleTime: 60_000,
    retry: 1,
  });
  useEffect(() => {
    setCsrfToken(q.data?.csrfToken ?? null);
  }, [q.data?.csrfToken]);
  const me = q.data?.authenticated ? (q.data.user ?? null) : null;
  const can = useCallback(
    (permission: string, env?: Environment) => {
      if (!me) return false;
      if (env) return me.permissions[env]?.includes(permission) ?? false;
      return Object.values(me.permissions).some((p) => p.includes(permission));
    },
    [me],
  );
  const value = useMemo<SessionCtx>(
    () => ({
      session: q.data,
      loading: q.isLoading,
      me,
      can,
      refresh: async () => {
        await qc.invalidateQueries();
      },
    }),
    [q.data, q.isLoading, me, can, qc],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('SessionProvider missing');
  return ctx;
}

// --------------------------------------------------------------- connection
interface ConnectionCtx {
  connections: Connection[];
  current: Connection | null;
  setCurrentId: (id: string) => void;
  loading: boolean;
  error: unknown;
}
const ConnectionContext = createContext<ConnectionCtx | null>(null);
const KEY = 'agiloft-control.connection';

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const q = useQuery({
    queryKey: ['connections'],
    queryFn: () => api<Connection[]>('/api/connections'),
    enabled: !!me,
  });
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  });
  const connections = q.data ?? [];
  const current = connections.find((c) => c.id === selected) ?? connections[0] ?? null;
  const setCurrentId = (id: string) => {
    setSelected(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <ConnectionContext.Provider
      value={{ connections, current, setCurrentId, loading: q.isLoading, error: q.error }}
    >
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection() {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error('ConnectionProvider missing');
  return ctx;
}

// ----------------------------------------------------------- announcements
type Tone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}
const AnnounceContext = createContext<(message: string, tone?: Tone) => void>(() => {});

/** Visible toasts plus an ARIA live region so screen readers hear outcomes. */
export function AnnounceProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const announce = useCallback((message: string, tone: Tone = 'info') => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      tone === 'error' ? 9000 : 5000,
    );
  }, []);
  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end"
        aria-live="polite"
        role="status"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-md rounded-md border px-4 py-3 text-sm shadow-lg ${
              t.tone === 'error'
                ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100'
                : t.tone === 'success'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100'
                  : 'border-slate-300 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </AnnounceContext.Provider>
  );
}

export const useAnnounce = () => useContext(AnnounceContext);

// -------------------------------------------------------------------- theme
export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return (localStorage.getItem('agiloft-control.theme') as 'light' | 'dark') ?? 'light';
    } catch {
      return 'light';
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('agiloft-control.theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}
