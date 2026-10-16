import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { ApiError } from './lib/api';
import {
  AnnounceProvider,
  ConnectionProvider,
  SessionProvider,
  useSession,
  useTheme,
} from './lib/context';
import { AppShell } from './components/layout';
import { LoadingState } from './components/states';
import { LoginPage } from './pages/login';
import { OverviewPage } from './pages/overview';
import { ConnectionsPage } from './pages/connections';
import { CapabilitiesPage } from './pages/capabilities';
import { SchemaPage } from './pages/schema';
import { RecordsPage } from './pages/records';
import { ScenarioPage } from './pages/scenario';
import { PlansPage, PlanDetailPage } from './pages/plans';
import { ApprovalsPage, ApprovalReviewPage } from './pages/approvals';
import { ExecutionsPage, ExecutionDetailPage } from './pages/executions';
import { AuditPage } from './pages/audit';
import { SettingsPage } from './pages/settings';
import { NotFoundPage } from './pages/not-found';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) =>
        !(err instanceof ApiError && [401, 403, 404].includes(err.status)) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

function RequireAuth() {
  const { session, loading } = useSession();
  const location = useLocation();
  useTheme();
  if (loading) {
    return (
      <div className="p-8">
        <LoadingState label="Checking your session…" />
      </div>
    );
  }
  if (!session?.authenticated)
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <ConnectionProvider>
      <Outlet />
    </ConnectionProvider>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: 'connections', element: <ConnectionsPage /> },
          { path: 'capabilities', element: <CapabilitiesPage /> },
          { path: 'schema', element: <SchemaPage /> },
          { path: 'schema/:table', element: <SchemaPage /> },
          { path: 'records', element: <RecordsPage /> },
          { path: 'scenario', element: <ScenarioPage /> },
          { path: 'plans', element: <PlansPage /> },
          { path: 'plans/:id', element: <PlanDetailPage /> },
          { path: 'approvals', element: <ApprovalsPage /> },
          { path: 'approvals/:id', element: <ApprovalReviewPage /> },
          { path: 'executions', element: <ExecutionsPage /> },
          { path: 'executions/:id', element: <ExecutionDetailPage /> },
          { path: 'audit', element: <AuditPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <AnnounceProvider>
          <RouterProvider router={router} />
        </AnnounceProvider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
