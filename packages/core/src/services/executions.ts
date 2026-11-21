import {
  AppError,
  AUTOMATED_KINDS,
  ChangePlanContentSchema,
  newId,
  TERMINAL_EXECUTION_STATUSES,
  WRITE_KINDS,
  type ExecutionStatus,
  type OperationStatus,
} from '@agiloft-control/shared';
import { orderOperations } from '@agiloft-control/change-planner';
import type { Db } from '../db/index.ts';
import type { ConnectionService } from './connections.ts';
import type { PlanService } from './plans.ts';
import { planHash } from './plans.ts';
import type { PolicyService } from './policies.ts';

export interface ExecutionView {
  id: string;
  planId: string;
  planVersion: number;
  planHash: string;
  planTitle: string;
  connectionId: string;
  environment: string;
  status: ExecutionStatus;
  requestedBy: string;
  requestedByName: string | null;
  requestedVia: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequested: boolean;
  runCount: number;
  summary: Record<string, unknown> | null;
  operations: {
    operationId: string;
    seq: number;
    kind: string;
    title: string;
    status: OperationStatus;
    attempts: number;
    recordId: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    result: Record<string, unknown> | null;
    error: Record<string, unknown> | null;
  }[];
  events: {
    id: number;
    at: string;
    level: string;
    operationId: string | null;
    message: string;
    data: unknown;
  }[];
}

export class ExecutionService {
  constructor(
    private readonly db: Db,
    private readonly plans: PlanService,
    private readonly connections: ConnectionService,
    private readonly policies: PolicyService,
  ) {}

  /**
   * Queues execution of an approved plan. Approval is looked up server-side;
   * nothing the caller sends can stand in for it. Every binding is re-checked:
   * version, content hash, connection, environment, expiry, invalidation and
   * current policy, plus a fresh validation against the live schema.
   */
  async request(
    planId: string,
    requestedBy: string,
    via: 'console' | 'mcp',
  ): Promise<ExecutionView> {
    const plan = await this.plans.planRow(planId);
    const existing = await this.db
      .selectFrom('executions')
      .select('id')
      .where('plan_id', '=', planId)
      .where('plan_version', '=', plan.current_version)
      .executeTakeFirst();
    if (existing) {
      throw new AppError(
        'DUPLICATE_EXECUTION',
        'This plan version has already been executed or is executing.',
        { details: { executionId: existing.id } },
      );
    }
    if (plan.status !== 'approved') {
      throw new AppError(
        'APPROVAL_INVALID',
        `Only approved plans can be executed. This plan is ${plan.status}. Approval is given by an approver in the Agiloft Control console.`,
      );
    }
    const version = await this.plans.versionRow(planId, plan.current_version);
    const content = ChangePlanContentSchema.parse(version.content);
    if (planHash(content) !== version.hash)
      throw new AppError('PLAN_CHANGED', 'Stored plan content does not match its approved hash.');

    const approval = await this.plans.currentApproval(planId, plan.current_version);
    if (!approval || approval.decision !== 'approved')
      throw new AppError('APPROVAL_INVALID', 'No approval exists for the current plan version.');
    if (approval.invalidated_at)
      throw new AppError(
        'APPROVAL_INVALID',
        `The approval was invalidated: ${approval.invalidated_reason ?? 'plan changed'}.`,
      );
    if (approval.plan_hash !== version.hash)
      throw new AppError('PLAN_CHANGED', 'The plan changed after approval.');
    if (approval.expires_at && new Date(approval.expires_at).getTime() < Date.now()) {
      throw new AppError(
        'APPROVAL_EXPIRED',
        'The approval has expired. Submit the plan for approval again.',
      );
    }
    const conn = await this.connections.meta(plan.connection_id);
    if (conn.disabled) throw new AppError('INVALID_STATE', 'The target connection is disabled.');
    if (
      approval.connection_id !== conn.id ||
      approval.environment !== conn.environment ||
      content.target.environment !== conn.environment ||
      content.target.connectionId !== conn.id
    ) {
      throw new AppError(
        'ENVIRONMENT_MISMATCH',
        'The approval was given for a different connection or environment.',
      );
    }
    const policy = await this.policies.get(conn.environment);
    if (!policy.writesEnabled && content.operations.some((o) => WRITE_KINDS.includes(o.kind))) {
      throw new AppError('POLICY_DENIED', `Writes are currently disabled for ${conn.environment}.`);
    }
    // Freshness: schema, capabilities and policy as they are now.
    const validation = await this.plans.runValidation(conn.id, content);
    if (!validation.valid) {
      throw new AppError(
        'VALIDATION_FAILED',
        'The plan no longer validates against the connected KB. Revise and re-approve it.',
        {
          details: { issues: validation.issues.filter((i) => i.severity === 'error') },
        },
      );
    }

    const id = newId('exe');
    const order = orderOperations(content.operations).order;
    await this.db.transaction().execute(async (trx) => {
      const moved = await trx
        .updateTable('plans')
        .set({ status: 'executing', updated_at: new Date() })
        .where('id', '=', planId)
        .where('status', '=', 'approved')
        .where('current_version', '=', plan.current_version)
        .executeTakeFirst();
      if (Number(moved.numUpdatedRows) !== 1)
        throw new AppError('DUPLICATE_EXECUTION', 'The plan is already executing or has changed.');
      try {
        await trx
          .insertInto('executions')
          .values({
            id,
            plan_id: planId,
            plan_version: plan.current_version,
            plan_hash: version.hash,
            approval_id: approval.id,
            connection_id: conn.id,
            environment: conn.environment,
            status: 'queued',
            requested_by: requestedBy,
            requested_via: via,
            started_at: null,
            finished_at: null,
            cancel_requested_by: null,
            lease_owner: null,
            lease_expires_at: null,
            summary: null,
          })
          .execute();
      } catch (e) {
        if (
          String((e as Error).message).includes('executions_plan_version_unique') ||
          (e as { code?: string }).code === '23505'
        ) {
          throw new AppError('DUPLICATE_EXECUTION', 'This plan version has already been executed.');
        }
        throw e;
      }
      for (const [seq, opId] of order.entries()) {
        const op = content.operations.find((o) => o.id === opId)!;
        await trx
          .insertInto('execution_operations')
          .values({
            execution_id: id,
            operation_id: op.id,
            seq,
            kind: op.kind,
            title: op.title,
            status: 'pending',
            record_id: op.recordId ?? null,
            started_at: null,
            finished_at: null,
            result: null,
            error: null,
          })
          .execute();
      }
      await trx
        .insertInto('execution_events')
        .values({
          execution_id: id,
          level: 'info',
          operation_id: null,
          message: `Queued by ${via}. ${content.operations.filter((o) => AUTOMATED_KINDS.includes(o.kind)).length} automated and ${content.operations.filter((o) => !AUTOMATED_KINDS.includes(o.kind)).length} manual operation(s).`,
          data: null,
        })
        .execute();
    });
    return this.get(id);
  }

  /** Cancellation takes effect between operations; an operation already in flight completes or is reconciled. */
  async cancel(executionId: string, by: string): Promise<ExecutionView> {
    const exe = await this.row(executionId);
    if (TERMINAL_EXECUTION_STATUSES.includes(exe.status as ExecutionStatus)) {
      throw new AppError('INVALID_STATE', `The execution already finished (${exe.status}).`);
    }
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('executions')
        .set({ cancel_requested: true, cancel_requested_by: by })
        .where('id', '=', executionId)
        .execute();
      await trx
        .insertInto('execution_events')
        .values({
          execution_id: executionId,
          level: 'warn',
          operation_id: null,
          message: 'Cancellation requested; it takes effect before the next operation.',
          data: null,
        })
        .execute();
      if (exe.status === 'queued') {
        await trx
          .updateTable('execution_operations')
          .set({ status: 'cancelled' })
          .where('execution_id', '=', executionId)
          .where('status', '=', 'pending')
          .execute();
        await trx
          .updateTable('executions')
          .set({ status: 'cancelled', finished_at: new Date() })
          .where('id', '=', executionId)
          .where('status', '=', 'queued')
          .execute();
        await trx
          .updateTable('plans')
          .set({ status: 'cancelled', updated_at: new Date() })
          .where('id', '=', exe.plan_id)
          .execute();
      }
    });
    return this.get(executionId);
  }

  async row(id: string) {
    const r = await this.db
      .selectFrom('executions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw new AppError('NOT_FOUND', 'Execution not found.');
    return r;
  }

  async get(id: string): Promise<ExecutionView> {
    const e = await this.db
      .selectFrom('executions')
      .innerJoin('plans', 'plans.id', 'executions.plan_id')
      .leftJoin('users', 'users.id', 'executions.requested_by')
      .selectAll('executions')
      .select(['plans.title as plan_title', 'users.display_name as requested_by_name'])
      .where('executions.id', '=', id)
      .executeTakeFirst();
    if (!e) throw new AppError('NOT_FOUND', 'Execution not found.');
    const ops = await this.db
      .selectFrom('execution_operations')
      .selectAll()
      .where('execution_id', '=', id)
      .orderBy('seq')
      .execute();
    const events = await this.db
      .selectFrom('execution_events')
      .selectAll()
      .where('execution_id', '=', id)
      .orderBy('id')
      .limit(500)
      .execute();
    const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
    return {
      id: e.id,
      planId: e.plan_id,
      planVersion: e.plan_version,
      planHash: e.plan_hash,
      planTitle: e.plan_title,
      connectionId: e.connection_id,
      environment: e.environment,
      status: e.status as ExecutionStatus,
      requestedBy: e.requested_by,
      requestedByName: e.requested_by_name ?? null,
      requestedVia: e.requested_via,
      createdAt: new Date(e.created_at).toISOString(),
      startedAt: iso(e.started_at),
      finishedAt: iso(e.finished_at),
      cancelRequested: e.cancel_requested,
      runCount: e.run_count,
      summary: (e.summary as Record<string, unknown> | null) ?? null,
      operations: ops.map((o) => ({
        operationId: o.operation_id,
        seq: o.seq,
        kind: o.kind,
        title: o.title,
        status: o.status as OperationStatus,
        attempts: o.attempts,
        recordId: o.record_id,
        startedAt: iso(o.started_at),
        finishedAt: iso(o.finished_at),
        result: (o.result as Record<string, unknown> | null) ?? null,
        error: (o.error as Record<string, unknown> | null) ?? null,
      })),
      events: events.map((ev) => ({
        id: ev.id,
        at: new Date(ev.at).toISOString(),
        level: ev.level,
        operationId: ev.operation_id,
        message: ev.message,
        data: ev.data,
      })),
    };
  }

  async forPlan(planId: string): Promise<ExecutionView | null> {
    const r = await this.db
      .selectFrom('executions')
      .select('id')
      .where('plan_id', '=', planId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    return r ? this.get(r.id) : null;
  }

  async list(filter: { status?: ExecutionStatus[]; environment?: string; limit?: number } = {}) {
    let q = this.db
      .selectFrom('executions')
      .innerJoin('plans', 'plans.id', 'executions.plan_id')
      .leftJoin('users', 'users.id', 'executions.requested_by')
      .select([
        'executions.id',
        'executions.plan_id',
        'executions.plan_version',
        'executions.status',
        'executions.environment',
        'executions.requested_via',
        'executions.created_at',
        'executions.finished_at',
        'plans.title',
        'users.display_name',
      ])
      .orderBy('executions.created_at', 'desc');
    if (filter.status?.length) q = q.where('executions.status', 'in', filter.status);
    if (filter.environment) q = q.where('executions.environment', '=', filter.environment);
    const rows = await q.limit(Math.min(filter.limit ?? 100, 500)).execute();
    const counts = rows.length
      ? await this.db
          .selectFrom('execution_operations')
          .select(['execution_id', 'status'])
          .where(
            'execution_id',
            'in',
            rows.map((r) => r.id),
          )
          .execute()
      : [];
    return rows.map((r) => {
      const mine = counts.filter((c) => c.execution_id === r.id);
      return {
        id: r.id,
        planId: r.plan_id,
        planVersion: r.plan_version,
        planTitle: r.title,
        status: r.status as ExecutionStatus,
        environment: r.environment,
        requestedVia: r.requested_via,
        requestedByName: r.display_name ?? null,
        createdAt: new Date(r.created_at).toISOString(),
        finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
        operations: {
          total: mine.length,
          succeeded: mine.filter((c) => c.status === 'succeeded').length,
          failed: mine.filter((c) => c.status === 'failed' || c.status === 'unknown').length,
          manual: mine.filter((c) => c.status === 'manual').length,
        },
      };
    });
  }
}
