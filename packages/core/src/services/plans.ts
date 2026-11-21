import { z } from 'zod';
import {
  AppError,
  ChangePlanContentSchema,
  hashObject,
  newId,
  WRITE_KINDS,
  type ChangePlanContent,
  type ChangePlanDocument,
  type Environment,
  type PlanStatus,
  type ValidationIssue,
} from '@agiloft-control/shared';
import { decideCapability } from '@agiloft-control/capabilities';
import {
  validatePlan,
  requiredCapabilities,
  type ValidationResult,
} from '@agiloft-control/change-planner';
import type { Db } from '../db/index.ts';
import type { ConnectionService } from './connections.ts';
import type { PolicyService } from './policies.ts';
import type { RecordService } from './records.ts';

export const DecisionInputSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(3, 'A reason is required').max(2_000),
  /** The version and hash the reviewer actually saw. Prevents approving something that changed underneath. */
  version: z.number().int().min(1),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});

export interface PlanSummary {
  id: string;
  title: string;
  status: PlanStatus;
  environment: Environment;
  connectionId: string;
  version: number;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  operationCount: number;
  writeCount: number;
  manualCount: number;
}

const EDITABLE: PlanStatus[] = ['draft', 'validated', 'awaiting_approval', 'approved', 'rejected'];

/** Hash over plan content only: status, approvals and execution state are excluded. */
export function planHash(content: ChangePlanContent): string {
  return hashObject(content);
}

export class PlanService {
  constructor(
    private readonly db: Db,
    private readonly connections: ConnectionService,
    private readonly records: RecordService,
    private readonly policies: PolicyService,
  ) {}

  /** Normalises incoming content and binds it to the connection's real target. */
  private async bind(connectionId: string, input: unknown): Promise<ChangePlanContent> {
    const conn = await this.connections.meta(connectionId);
    const obj = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const parsed = ChangePlanContentSchema.safeParse({
      ...obj,
      target: {
        connectionId: conn.id,
        environment: conn.environment,
        kbName: conn.kbName,
        instanceLabel: conn.name,
      },
    });
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'The plan does not match the change-plan schema.', {
        details: {
          issues: parsed.error.issues.slice(0, 30).map((i) => `${i.path.join('.')}: ${i.message}`),
        },
      });
    }
    // Capability evidence is always derived server-side, never accepted from the caller.
    const instance = await this.connections.instanceCapabilities(conn.id);
    const ids = new Set(
      parsed.data.operations.flatMap((o) => [...requiredCapabilities(o), ...o.capabilityIds]),
    );
    parsed.data.capabilityEvidence = [...ids].sort().map((id) => {
      const d = decideCapability(id, instance);
      return {
        capabilityId: id,
        docStatus: d.definition?.docStatus ?? 'unverified',
        instanceStatus: d.instanceStatus,
        evidenceUrl: d.definition?.evidence[0]?.url ?? null,
        checkedAt: d.definition?.evidence[0]?.checkedAt ?? null,
      };
    });
    return parsed.data;
  }

  async create(
    connectionId: string,
    input: unknown,
    createdBy: string,
  ): Promise<ChangePlanDocument> {
    const content = await this.bind(connectionId, input);
    const id = newId('plan');
    const hash = planHash(content);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('plans')
        .values({
          id,
          connection_id: connectionId,
          environment: content.target.environment,
          title: content.title,
          status: 'draft',
          current_version: 1,
          created_by: createdBy,
          submitted_by: null,
          submitted_at: null,
        })
        .execute();
      await trx
        .insertInto('plan_versions')
        .values({
          plan_id: id,
          version: 1,
          content: JSON.stringify(content),
          hash,
          created_by: createdBy,
          validation: null,
          validated_at: null,
        })
        .execute();
    });
    return this.document(id);
  }

  /** Any change creates a new version, returns the plan to draft and invalidates prior approvals. */
  async revise(planId: string, input: unknown, revisedBy: string): Promise<ChangePlanDocument> {
    const plan = await this.planRow(planId);
    if (!EDITABLE.includes(plan.status as PlanStatus)) {
      throw new AppError(
        'INVALID_STATE',
        `A plan that is ${plan.status} cannot be changed. Create a new plan instead.`,
      );
    }
    const content = await this.bind(plan.connection_id, input);
    const hash = planHash(content);
    const version = plan.current_version + 1;
    await this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('plans')
        .set({
          current_version: version,
          status: 'draft',
          title: content.title,
          submitted_by: null,
          submitted_at: null,
          updated_at: new Date(),
        })
        .where('id', '=', planId)
        .where('current_version', '=', plan.current_version)
        .where('status', 'in', EDITABLE)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) !== 1)
        throw new AppError('CONFLICT', 'The plan was changed concurrently. Reload and try again.');
      await trx
        .insertInto('plan_versions')
        .values({
          plan_id: planId,
          version,
          content: JSON.stringify(content),
          hash,
          created_by: revisedBy,
          validation: null,
          validated_at: null,
        })
        .execute();
      await trx
        .updateTable('approvals')
        .set({ invalidated_at: new Date(), invalidated_reason: `Superseded by version ${version}` })
        .where('plan_id', '=', planId)
        .where('invalidated_at', 'is', null)
        .execute();
    });
    return this.document(planId);
  }

  async validate(
    planId: string,
  ): Promise<{ document: ChangePlanDocument; result: ValidationResult }> {
    const plan = await this.planRow(planId);
    const version = await this.versionRow(planId, plan.current_version);
    const result = await this.runValidation(plan.connection_id, version.content);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('plan_versions')
        .set({ validation: JSON.stringify(result), validated_at: new Date() })
        .where('plan_id', '=', planId)
        .where('version', '=', plan.current_version)
        .execute();
      if (plan.status === 'draft' || plan.status === 'validated') {
        await trx
          .updateTable('plans')
          .set({ status: result.valid ? 'validated' : 'draft', updated_at: new Date() })
          .where('id', '=', planId)
          .where('current_version', '=', plan.current_version)
          .execute();
      }
    });
    return { document: await this.document(planId), result };
  }

  /** Validation against live schema, capabilities and policy. Used again immediately before execution. */
  async runValidation(connectionId: string, content: unknown): Promise<ValidationResult> {
    const conn = await this.connections.meta(connectionId);
    const parsed = ChangePlanContentSchema.safeParse(content);
    const tables = parsed.success
      ? parsed.data.operations.map((o) => o.table).filter((t): t is string => !!t)
      : [];
    const schemas = await this.records.schemas(connectionId, tables);
    const policy = await this.policies.get(conn.environment);
    return validatePlan(content, {
      connection: { id: conn.id, environment: conn.environment },
      schemas,
      instanceCapabilities: await this.connections.instanceCapabilities(connectionId),
      policy: {
        writesEnabled: policy.writesEnabled,
        allowedWriteTables: policy.allowedWriteTables,
      },
    });
  }

  async submit(planId: string, submittedBy: string): Promise<ChangePlanDocument> {
    const plan = await this.planRow(planId);
    if (plan.status !== 'validated') {
      throw new AppError(
        'INVALID_STATE',
        `Only validated plans can be submitted for approval (current status: ${plan.status}).`,
      );
    }
    const version = await this.versionRow(planId, plan.current_version);
    const v = version.validation as unknown as ValidationResult | null;
    if (!v?.valid)
      throw new AppError('INVALID_STATE', 'The current version has not passed validation.');
    await this.transition(planId, plan.current_version, ['validated'], 'awaiting_approval', {
      submitted_by: submittedBy,
      submitted_at: new Date(),
    });
    return this.document(planId);
  }

  /**
   * Records a human approval decision. Approval is bound to the exact version,
   * content hash, connection and environment, and expires per policy.
   */
  async decide(
    planId: string,
    input: z.input<typeof DecisionInputSchema>,
    deciderId: string,
  ): Promise<ChangePlanDocument> {
    const d = DecisionInputSchema.parse(input);
    const plan = await this.planRow(planId);
    if (plan.status !== 'awaiting_approval') {
      throw new AppError('INVALID_STATE', `This plan is ${plan.status}, not awaiting approval.`);
    }
    const version = await this.versionRow(planId, plan.current_version);
    if (d.version !== plan.current_version || d.hash !== version.hash) {
      throw new AppError(
        'PLAN_CHANGED',
        'The plan changed after you opened it. Review the current version before deciding.',
      );
    }
    if (planHash(ChangePlanContentSchema.parse(version.content)) !== version.hash) {
      throw new AppError(
        'PLAN_CHANGED',
        'Stored plan content does not match its hash. The plan cannot be approved.',
      );
    }
    const conn = await this.connections.meta(plan.connection_id);
    if (conn.environment !== plan.environment) {
      throw new AppError(
        'ENVIRONMENT_MISMATCH',
        'The connection environment differs from the plan environment.',
      );
    }
    const policy = await this.policies.get(conn.environment);
    if (
      policy.requireSeparationOfDuties &&
      [plan.created_by, plan.submitted_by, version.created_by].includes(deciderId)
    ) {
      throw new AppError(
        'FORBIDDEN',
        'Separation of duties: you created or submitted this plan, so another approver must decide.',
      );
    }
    const expires =
      d.decision === 'approved' ? new Date(Date.now() + policy.approvalTtlMinutes * 60_000) : null;
    await this.db.transaction().execute(async (trx) => {
      const res = await trx
        .updateTable('plans')
        .set({ status: d.decision, updated_at: new Date() })
        .where('id', '=', planId)
        .where('status', '=', 'awaiting_approval')
        .where('current_version', '=', d.version)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) !== 1)
        throw new AppError('CONFLICT', 'The plan changed while you were deciding.');
      await trx
        .insertInto('approvals')
        .values({
          id: newId('apr'),
          plan_id: planId,
          plan_version: d.version,
          plan_hash: d.hash,
          connection_id: conn.id,
          environment: conn.environment,
          decision: d.decision,
          reason: d.reason,
          decided_by: deciderId,
          expires_at: expires,
          invalidated_at: null,
          invalidated_reason: null,
        })
        .execute();
    });
    return this.document(planId);
  }

  async transition(
    planId: string,
    version: number,
    from: PlanStatus[],
    to: PlanStatus,
    extra: Record<string, unknown> = {},
  ) {
    const res = await this.db
      .updateTable('plans')
      .set({ status: to, updated_at: new Date(), ...extra })
      .where('id', '=', planId)
      .where('current_version', '=', version)
      .where('status', 'in', from)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) !== 1)
      throw new AppError('CONFLICT', 'The plan changed concurrently. Reload and try again.');
  }

  async planRow(planId: string) {
    const r = await this.db
      .selectFrom('plans')
      .selectAll()
      .where('id', '=', planId)
      .executeTakeFirst();
    if (!r) throw new AppError('NOT_FOUND', 'Plan not found.');
    return r;
  }

  async versionRow(planId: string, version: number) {
    const r = await this.db
      .selectFrom('plan_versions')
      .selectAll()
      .where('plan_id', '=', planId)
      .where('version', '=', version)
      .executeTakeFirst();
    if (!r) throw new AppError('NOT_FOUND', 'Plan version not found.');
    return r;
  }

  async currentApproval(planId: string, version: number) {
    return this.db
      .selectFrom('approvals')
      .selectAll()
      .where('plan_id', '=', planId)
      .where('plan_version', '=', version)
      .orderBy('decided_at', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  async document(planId: string, versionNo?: number): Promise<ChangePlanDocument> {
    const plan = await this.planRow(planId);
    const v = await this.versionRow(planId, versionNo ?? plan.current_version);
    const approval = await this.currentApproval(planId, v.version);
    const execution = await this.db
      .selectFrom('executions')
      .select(['id', 'status'])
      .where('plan_id', '=', planId)
      .where('plan_version', '=', v.version)
      .executeTakeFirst();
    const isCurrent = v.version === plan.current_version;
    let state: ChangePlanDocument['approval']['state'] = 'none';
    if (plan.status === 'awaiting_approval' && isCurrent) state = 'pending';
    if (approval) {
      if (approval.invalidated_at) state = 'invalidated';
      else if (approval.decision === 'rejected') state = 'rejected';
      else if (
        approval.expires_at &&
        new Date(approval.expires_at).getTime() < Date.now() &&
        !execution
      )
        state = 'expired';
      else state = 'approved';
    }
    const validation = v.validation as unknown as ValidationResult | null;
    return {
      planId,
      version: v.version,
      hash: v.hash,
      status: isCurrent ? (plan.status as PlanStatus) : 'draft',
      createdBy: plan.created_by,
      createdAt: new Date(plan.created_at).toISOString(),
      updatedAt: new Date(plan.updated_at).toISOString(),
      validation: validation
        ? {
            valid: validation.valid,
            issues: validation.issues as ValidationIssue[],
            validatedAt: new Date(v.validated_at ?? v.created_at).toISOString(),
          }
        : null,
      approval: {
        state,
        ...(approval
          ? {
              decidedBy: approval.decided_by,
              decidedAt: new Date(approval.decided_at).toISOString(),
              reason: approval.reason,
              ...(approval.expires_at
                ? { expiresAt: new Date(approval.expires_at).toISOString() }
                : {}),
            }
          : {}),
      },
      execution: execution ? { id: execution.id, status: execution.status as never } : null,
      content: ChangePlanContentSchema.parse(v.content),
    };
  }

  async versions(planId: string) {
    const rows = await this.db
      .selectFrom('plan_versions')
      .select(['version', 'hash', 'created_by', 'created_at', 'validated_at'])
      .where('plan_id', '=', planId)
      .orderBy('version', 'desc')
      .execute();
    return rows.map((r) => ({
      version: r.version,
      hash: r.hash,
      createdBy: r.created_by,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  async list(
    filter: {
      status?: PlanStatus[];
      environment?: Environment;
      connectionId?: string;
      limit?: number;
    } = {},
  ): Promise<PlanSummary[]> {
    let q = this.db
      .selectFrom('plans')
      .innerJoin('plan_versions', (j) =>
        j
          .onRef('plan_versions.plan_id', '=', 'plans.id')
          .onRef('plan_versions.version', '=', 'plans.current_version'),
      )
      .leftJoin('users', 'users.id', 'plans.created_by')
      .select([
        'plans.id',
        'plans.title',
        'plans.status',
        'plans.environment',
        'plans.connection_id',
        'plans.current_version',
        'plans.created_by',
        'plans.created_at',
        'plans.updated_at',
        'plan_versions.content',
        'users.display_name',
      ])
      .orderBy('plans.updated_at', 'desc');
    if (filter.status?.length) q = q.where('plans.status', 'in', filter.status);
    if (filter.environment) q = q.where('plans.environment', '=', filter.environment);
    if (filter.connectionId) q = q.where('plans.connection_id', '=', filter.connectionId);
    const rows = await q.limit(Math.min(filter.limit ?? 100, 500)).execute();
    return rows.map((r) => {
      const ops = (r.content as unknown as ChangePlanContent).operations ?? [];
      const writes = ops.filter((o) => WRITE_KINDS.includes(o.kind)).length;
      return {
        id: r.id,
        title: r.title,
        status: r.status as PlanStatus,
        environment: r.environment as Environment,
        connectionId: r.connection_id,
        version: r.current_version,
        createdBy: r.created_by,
        createdByName: r.display_name ?? null,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
        operationCount: ops.length,
        writeCount: writes,
        manualCount: ops.filter(
          (o) => o.kind === 'manual.configure' || o.kind === 'external.orchestrate',
        ).length,
      };
    });
  }
}
