import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogIn, ShieldCheck } from 'lucide-react';
import { api, ApiError, post } from '../lib/api';
import { useTheme } from '../lib/context';
import { Button, Callout } from '../components/ui';
import { LoadingState } from '../components/states';

interface AuthConfig {
  mode: 'dev' | 'oidc';
  devUsers: { email: string; name: string; description: string }[];
}

export function LoginPage() {
  useTheme();
  const q = useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api<AuthConfig>('/api/auth/config'),
  });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function devLogin(email: string) {
    setBusy(email);
    setError(null);
    try {
      await post('/api/auth/dev-login', { email });
      await qc.invalidateQueries();
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign-in failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-10" />
          <div>
            <h1 className="text-xl font-semibold">Agiloft Control</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Governed AI and administrator access to Agiloft
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {q.isLoading && <LoadingState rows={2} />}
          {q.error && (
            <Callout tone="danger">Agiloft Control is unreachable. Try again shortly.</Callout>
          )}
          {q.data?.mode === 'oidc' && (
            <>
              <h2 className="text-base font-semibold">Sign in</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Use your organisation account.
              </p>
              <a
                href="/api/auth/login"
                className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800"
              >
                <ShieldCheck className="size-4" aria-hidden /> Sign in with single sign-on
              </a>
            </>
          )}
          {q.data?.mode === 'dev' && (
            <>
              <h2 className="text-base font-semibold">Development sign-in</h2>
              <Callout tone="warning">
                Local development login. It cannot be enabled when <code>NODE_ENV=production</code>;
                deployments use OIDC.
              </Callout>
              <ul className="mt-4 space-y-2">
                {q.data.devUsers.map((u) => (
                  <li key={u.email}>
                    <Button
                      className="h-auto w-full justify-between py-3 text-left"
                      onClick={() => devLogin(u.email)}
                      busy={busy === u.email}
                      icon={<LogIn className="size-4" aria-hidden />}
                    >
                      <span className="flex-1">
                        <span className="block font-medium">{u.name}</span>
                        <span className="block text-xs font-normal text-slate-600 dark:text-slate-400">
                          {u.description}
                        </span>
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {error && (
            <p className="mt-4 text-sm text-red-700 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
