import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldX } from 'lucide-react';
import { api, ApiError, post } from '../lib/api';
import { useAnnounce, useSession } from '../lib/context';
import type { PlanDetail, PlanSummary } from '../lib/types';
import { PageHeader } from '../components/layout';
import { Button, Callout, Card, Field, Textarea } from '../components/ui';
import { EmptyState, QueryState } from '../components/states';
import { PlanReview, PlanTable, usePlan } from './plans';

export function ApprovalsPage() {
  const q = useQuery({
    queryKey: ['plans', 'awaiting_approval'],
    queryFn: () => api<PlanSummary[]>('/api/plans?status=awaiting_approval'),
  });
  return (
    <>
      <PageHeader
        title="Approvals"
        crumbs={[{ label: 'Overview', to: '/' }, { label: 'Approvals' }]}
        description="Plans awaiting a human decision. Approval is bound to the exact version and content hash you review."
      />
      <QueryState
        q={q}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title="Nothing awaiting approval" />}
      >
        {(plans) => <PlanTable plans={plans} linkBase="/approvals" />}
      </QueryState>
    </>
  );
}

export function ApprovalReviewPage() {
  const { id } = useParams();
  const q = usePlan(id);
  return (
    <QueryState q={q}>
      {(plan) => (
        <>
          <PageHeader
            title={`Review: ${plan.content.title}`}
            crumbs={[{ label: 'Approvals', to: '/approvals' }, { label: plan.planId }]}
          />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_22rem]">
            <div className="min-w-0">
              <PlanReview plan={plan} />
            </div>
            <div className="xl:sticky xl:top-20 xl:self-start">
              <DecisionPanel plan={plan} />
            </div>
          </div>
        </>
      )}
    </QueryState>
  );
}

function DecisionPanel({ plan }: { plan: PlanDetail }) {
  const { can, me } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const announce = useAnnounce();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const env = plan.content.target.environment;
  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') =>
      post<PlanDetail>(`/api/plans/${plan.planId}/decision`, {
        decision,
        reason,
        version: plan.version,
        hash: plan.hash,
      }),
    onSuccess: (doc) => {
      announce(`Plan ${doc.status === 'approved' ? 'approved' : 'rejected'}.`, 'success');
      void qc.invalidateQueries();
      navigate(`/plans/${plan.planId}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Decision failed.'),
  });

  if (plan.status !== 'awaiting_approval') {
    return (
      <Card title="Decision">
        <p className="text-sm">
          This plan is not awaiting approval (status: {plan.status.replace('_', ' ')}).
        </p>
      </Card>
    );
  }
  if (!can('plans:approve', env)) {
    return (
      <Card title="Decision">
        <Callout tone="warning">
          You do not have the approver role for the {env} environment.
        </Callout>
      </Card>
    );
  }
  const blocked = plan.validation && !plan.validation.valid;
  const selfAuthored = me?.userId === plan.createdBy;
  return (
    <Card
      title="Decision"
      description="Server-side checks apply: separation of duties, version and hash binding, environment and expiry."
    >
      <div className="space-y-4">
        <p className="break-all font-mono text-xs text-slate-600 dark:text-slate-400">
          Approving v{plan.version} · {plan.hash}
        </p>
        {selfAuthored && (
          <Callout tone="warning">
            You created this plan. If separation of duties is enabled, the server will refuse your
            approval.
          </Callout>
        )}
        {blocked && (
          <Callout tone="danger">
            The latest validation found errors. Approval should not proceed until the plan is
            revised.
          </Callout>
        )}
        <Field label="Reason" required hint="Recorded in the audit log with your decision.">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
            />
          )}
        </Field>
        {error && (
          <p className="text-sm text-red-700 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            icon={<ShieldCheck className="size-4" aria-hidden />}
            disabled={reason.trim().length < 3}
            busy={decide.isPending && decide.variables === 'approved'}
            onClick={() => decide.mutate('approved')}
          >
            Approve
          </Button>
          <Button
            variant="danger"
            icon={<ShieldX className="size-4" aria-hidden />}
            disabled={reason.trim().length < 3}
            busy={decide.isPending && decide.variables === 'rejected'}
            onClick={() => decide.mutate('rejected')}
          >
            Reject
          </Button>
        </div>
      </div>
    </Card>
  );
}
