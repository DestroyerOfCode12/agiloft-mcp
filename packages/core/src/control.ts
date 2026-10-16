import { z } from 'zod';
import {
  AppError,
  asUntrusted,
  ENVIRONMENTS,
  EnvironmentSchema,
  FieldValueSchema,
  LOGICAL_NAME,
  RoleSchema,
  type ChangePlanDocument,
  type Environment,
  type Permission,
  type PlanStatus,
} from '@agiloft-control/shared';
import {
  CAPABILITIES,
  summariseCapabilities,
  type InstanceCapabilityResult,
} from '@agiloft-control/capabilities';
import {
  analyseScenario,
  buildRecordCreatePlan,
  buildRecordUpdatePlan,
  interpretDeterministically,
  planFromScenario,
  StructuredRequirementsSchema,
  type InterpretationResult,
} from '@agiloft-control/change-planner';
import type { SearchRequestInput } from '@agiloft-control/agiloft-client';
import type { AppConfig } from './config.ts';
import type { Db } from './db/index.ts';
import { checkPermission, type Principal } from './principal.ts';
import { AuditService, type AuditQuery } from './services/audit.ts';
import type { ConnectionService, LiveConnectionInput } from './services/connections.ts';
import type { ExecutionService } from './services/executions.ts';
import type { PlanService } from './services/plans.ts';
import type { PolicyService, EnvironmentPolicy } from './services/policies.ts';
import { mapAgiloftError, type RecordService } from './services/records.ts';
import type { UserService } from './services/users.ts';
import type { AnthropicInterpreter } from './services/model-interpreter.ts';

export const PrepareCreateSchema = z.object({
  table: z.string().regex(LOGICAL_NAME),
  fields: z.record(z.string().regex(LOGICAL_NAME), FieldValueSchema),
  reconcileBy: z
    .object({ field: z.string().regex(LOGICAL_NAME), value: z.string().min(1).max(500) })
    .optional(),
  title: z.string().max(200).optional(),
  reason: z.string().max(2_000).optional(),
});

export const PrepareUpdateSchema = z.object({
  table: z.string().regex(LOGICAL_NAME),
  recordId: z.string().regex(/^\d{1,18}$/),
  fields: z.record(z.string().regex(LOGICAL_NAME), FieldValueSchema),
  title: z.string().max(200).optional(),
  reason: z.string().max(2_000).optional(),
});

export const ScenarioInputSchema = z
  .object({
    text: z.string().trim().min(10).max(5_000).optional(),
    requirements: StructuredRequirementsSchema.optional(),
    useModel: z.boolean().default(false),
  })
  .refine((v) => v.text || v.requirements, 'Provide scenario text or structured requirements.');

export interface Deps {
  config: AppConfig;
  db: Db;
  audit: AuditService;
  users: UserService;
  policies: PolicyService;
  connections: ConnectionService;
  records: RecordService;
  plans: PlanService;
  executions: ExecutionService;
  interpreter: AnthropicInterpreter | null;
}

/**
 * Agiloft Control application service. The MCP server and the console API are
 * thin adapters over this class, so authorization, policy, approval binding
 * and auditing are identical for both.
 */
export class AgiloftControl {
  constructor(private readonly d: Deps) {}

  // ------------------------------------------------------------ authorization
  private async authorize(
    p: Principal,
    permission: Permission,
    ctx: {
      environment?: Environment;
      action: string;
      targetType?: string;
      targetId?: string;
      connectionId?: string;
    },
  ) {
    const decision = checkPermission(p, permission, ctx.environment);
    if (!decision.ok) {
      await this.d.audit.record({
        principal: p,
        action: ctx.action,
        result: 'denied',
        environment: ctx.environment ?? null,
        connectionId: ctx.connectionId ?? null,
        targetType: ctx.targetType ?? null,
        targetId: ctx.targetId ?? null,
        details: { permission, reason: decision.reason },
      });
      throw new AppError('FORBIDDEN', decision.reason);
    }
  }

  private async connEnv(connectionId: string) {
    return this.d.connections.meta(connectionId);
  }

  private async planEnv(planId: string) {
    const plan = await this.d.plans.planRow(planId);
    return { plan, environment: plan.environment as Environment };
  }

  private async ok(
    p: Principal,
    action: string,
    extra: {
      environment?: string | null;
      connectionId?: string | null;
      targetType?: string;
      targetId?: string | null;
      details?: Record<string, unknown>;
    } = {},
  ) {
    await this.d.audit.record({ principal: p, action, result: 'success', ...extra });
  }

  /** Records a failed attempt (after authorization) and rethrows. */
  private async failing<T>(
    p: Principal,
    action: string,
    extra: { environment?: string; connectionId?: string; targetType?: string; targetId?: string },
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const err = e instanceof AppError ? e : null;
      await this.d.audit.record({
        principal: p,
        action,
        result: 'failure',
        ...extra,
        details: { code: err?.code ?? 'INTERNAL', message: err?.message ?? 'unexpected error' },
      });
      throw e;
    }
  }

  // ---------------------------------------------------------------- identity
  async me(p: Principal) {
    const perms: Record<string, Permission[]> = {};
    for (const env of ENVIRONMENTS) {
      perms[env] = (
        [
          'connections:read',
          'connections:manage',
          'capabilities:read',
          'capabilities:verify',
          'schema:read',
          'records:read',
          'plans:read',
          'plans:write',
          'plans:approve',
          'executions:read',
          'executions:run',
          'executions:cancel',
          'audit:read',
          'audit:export',
          'settings:read',
          'settings:manage',
          'users:manage',
          'demo:control',
        ] as Permission[]
      ).filter((perm) => checkPermission(p, perm, env).ok);
    }
    return {
      userId: p.userId,
      email: p.email,
      displayName: p.displayName,
      roles: p.roles,
      via: p.via,
      permissions: perms,
    };
  }

  // ------------------------------------------------------------- connections
  async listConnections(p: Principal) {
    const all = await this.d.connections.list();
    return all.filter((c) => checkPermission(p, 'connections:read', c.environment).ok);
  }

  /** Resolves the connection to use: explicit, or the only one the caller can see. */
  async resolveConnection(p: Principal, connectionId?: string): Promise<string> {
    if (connectionId) return connectionId;
    const visible = await this.listConnections(p);
    if (visible.length === 1) return visible[0]!.id;
    throw new AppError(
      'VALIDATION_FAILED',
      visible.length
        ? 'Several connections are available; specify connection_id.'
        : 'No connection is available to you.',
      {
        details: {
          connections: visible.map((c) => ({ id: c.id, name: c.name, environment: c.environment })),
        },
      },
    );
  }

  async getConnection(p: Principal, id: string) {
    const c = await this.d.connections.get(id);
    await this.authorize(p, 'connections:read', {
      environment: c.environment,
      action: 'connections.read',
      targetType: 'connection',
      targetId: id,
    });
    return c;
  }

  async createConnection(p: Principal, input: LiveConnectionInput) {
    const env = EnvironmentSchema.parse((input as { environment?: string }).environment);
    await this.authorize(p, 'connections:manage', {
      environment: env,
      action: 'connections.create',
    });
    return this.failing(p, 'connections.create', { environment: env }, async () => {
      const c = await this.d.connections.createLive(input, p.userId).catch(mapAgiloftError);
      await this.ok(p, 'connections.create', {
        environment: c.environment,
        connectionId: c.id,
        targetType: 'connection',
        targetId: c.id,
        details: { name: c.name, baseUrl: c.baseUrl, authMethod: c.authMethod },
      });
      return c;
    });
  }

  async updateConnection(p: Principal, id: string, patch: Record<string, unknown>) {
    const meta = await this.connEnv(id);
    await this.authorize(p, 'connections:manage', {
      environment: meta.environment,
      action: 'connections.update',
      targetId: id,
      connectionId: id,
    });
    return this.failing(
      p,
      'connections.update',
      { environment: meta.environment, connectionId: id },
      async () => {
        const c = await this.d.connections.update(id, patch).catch(mapAgiloftError);
        await this.ok(p, 'connections.update', {
          environment: c.environment,
          connectionId: id,
          targetType: 'connection',
          targetId: id,
          details: { fields: Object.keys(patch).map((k) => (k === 'auth' ? 'credentials' : k)) },
        });
        return c;
      },
    );
  }

  async testConnection(p: Principal, id: string) {
    const meta = await this.connEnv(id);
    await this.authorize(p, 'capabilities:verify', {
      environment: meta.environment,
      action: 'connections.verify',
      connectionId: id,
    });
    const report = await this.d.connections.verify(id);
    await this.d.audit.record({
      principal: p,
      action: 'connections.verify',
      result: report.ok ? 'success' : 'failure',
      environment: meta.environment,
      connectionId: id,
      targetType: 'connection',
      targetId: id,
      details: { summary: report.summary },
    });
    return report;
  }

  // ------------------------------------------------------------ capabilities
  async capabilities(p: Principal, connectionId?: string) {
    let instance: InstanceCapabilityResult[] = [];
    let connection = null;
    if (connectionId) {
      const meta = await this.connEnv(connectionId);
      await this.authorize(p, 'capabilities:read', {
        environment: meta.environment,
        action: 'capabilities.read',
        connectionId,
      });
      instance = await this.d.connections.instanceCapabilities(connectionId);
      connection = { id: meta.id, name: meta.name, environment: meta.environment, mode: meta.mode };
    }
    return {
      connection,
      summary: summariseCapabilities(instance),
      capabilities: CAPABILITIES.map((c) => ({
        ...c,
        instance: instance.find((i) => i.capabilityId === c.id) ?? null,
      })),
      notes: [
        'Documentation status reflects official Agiloft documentation checked on the date shown for each entry.',
        'Instance status reflects a read-only probe of the selected connection. Results marked synthetic come from the demo adapter and say nothing about a real Agiloft instance.',
      ],
    };
  }

  // ------------------------------------------------------------- schema/data
  async listTables(p: Principal, connectionId: string, search?: string) {
    const meta = await this.connEnv(connectionId);
    await this.authorize(p, 'schema:read', {
      environment: meta.environment,
      action: 'schema.list',
      connectionId,
    });
    return this.d.records.listTables(connectionId, search);
  }

  async describeTable(p: Principal, connectionId: string, table: string) {
    const meta = await this.connEnv(connectionId);
    await this.authorize(p, 'schema:read', {
      environment: meta.environment,
      action: 'schema.describe',
      connectionId,
    });
    const schema = await this.d.records.describeTable(connectionId, table);
    return {
      ...schema,
      editable: false,
      editNote:
        'Schema changes are not available: no documented Agiloft API exists for creating or modifying tables or fields.',
    };
  }

  async search(p: Principal, connectionId: string, req: SearchRequestInput) {
    const meta = await this.connEnv(connectionId);
    await this.authorize(p, 'records:read', {
      environment: meta.environment,
      action: 'records.search',
      connectionId,
    });
    const res = await this.d.records.search(connectionId, req);
    await this.ok(p, 'records.search', {
      environment: meta.environment,
      connectionId,
      targetType: `agiloft:${res.table}`,
      details: { query: res.query, returned: res.records.length },
    });
    return res;
  }

  async getRecord(
    p: Principal,
    connectionId: string,
    table: string,
    id: string,
    fields?: string[],
  ) {
    const meta = await this.connEnv(connectionId);
    await this.authorize(p, 'records:read', {
      environment: meta.environment,
      action: 'records.read',
      connectionId,
    });
    const rec = await this.d.records.get(connectionId, table, id, fields);
    await this.ok(p, 'records.read', {
      environment: meta.environment,
      connectionId,
      targetType: `agiloft:${table}`,
      targetId: id,
    });
    return rec;
  }

  async relatedRecords(p: Principal, connectionId: string, table: string, id: string) {
    const meta = await this.connEnv(connectionId);
    await this.authorize(p, 'records:read', {
      environment: meta.environment,
      action: 'records.related',
      connectionId,
    });
    return this.d.records.related(connectionId, table, id);
  }

  // ------------------------------------------------------------------- plans
  private target(meta: { id: string; environment: Environment; kbName: string; name: string }) {
    return {
      connectionId: meta.id,
      environment: meta.environment,
      kbName: meta.kbName,
      instanceLabel: meta.name,
    };
  }

  private async afterCreate(p: Principal, doc: ChangePlanDocument, source: string) {
    await this.ok(p, 'plans.create', {
      environment: doc.content.target.environment,
      connectionId: doc.content.target.connectionId,
      targetType: 'plan',
      targetId: doc.planId,
      details: { source, title: doc.content.title, hash: doc.hash },
    });
    const { document } = await this.d.plans.validate(doc.planId);
    return document;
  }

  async prepareRecordCreate(
    p: Principal,
    connectionId: string,
    input: z.input<typeof PrepareCreateSchema>,
  ) {
    const meta = await this.connEnv(connectionId);
    await this.authorize(p, 'plans:write', {
      environment: meta.environment,
      action: 'plans.create',
      connectionId,
    });
    const data = PrepareCreateSchema.parse(input);
    const table = await this.d.records.describeTable(connectionId, data.table);
    const content = buildRecordCreatePlan({
      target: this.target(meta),
      table,
      fields: data.fields,
      reconcileBy: data.reconcileBy,
      title: data.title,
      reason: data.reason,
      source: p.via === 'mcp' ? 'mcp' : 'console',
    });
    return this.afterCreate(
      p,
      await this.d.plans.create(connectionId, content, p.userId),
      'prepare_record_create',
    );
  }

  async prepareRecordUpdate(
    p: Principal,
    connectionId: string,
    input: z.input<typeof PrepareUpdateSchema>,
  ) {
    const meta = await this.connEnv(connectionId);
    await this.authorize(p, 'plans:write', {
      environment: meta.environment,
      action: 'plans.create',
      connectionId,
    });
    const data = PrepareUpdateSchema.parse(input);
    const table = await this.d.records.describeTable(connectionId, data.table);
    const adapter = await this.d.connections.adapter(connectionId);
    const current = await adapter.read(data.table, data.recordId).catch(mapAgiloftError);
    const content = buildRecordUpdatePlan({
      target: this.target(meta),
      table,
      current,
      fields: data.fields,
      title: data.title,
      reason: data.reason,
      source: p.via === 'mcp' ? 'mcp' : 'console',
    });
    return this.afterCreate(
      p,
      await this.d.plans.create(connectionId, content, p.userId),
      'prepare_record_update',
    );
  }

  async analyseScenario(
    p: Principal,
    connectionId: string,
    input: z.input<typeof ScenarioInputSchema>,
  ) {
    const meta = await this.connEnv(connectionId);
    await this.authorize(p, 'schema:read', {
      environment: meta.environment,
      action: 'scenario.analyse',
      connectionId,
    });
    const data = ScenarioInputSchema.parse(input);
    let interpretation: InterpretationResult;
    if (data.requirements) {
      interpretation = {
        requirements: data.requirements,
        recognised: [],
        unrecognised: [],
        interpreter: 'structured',
      };
    } else if (data.useModel) {
      if (!this.d.interpreter)
        throw new AppError(
          'NOT_CONFIGURED',
          'No model provider is configured. Use the structured form, or ask an administrator to set MODEL_PROVIDER.',
        );
      interpretation = await this.d.interpreter.interpret(data.text!);
    } else {
      interpretation = interpretDeterministically(data.text!);
    }
    const catalog = await this.scenarioCatalog(
      connectionId,
      interpretation.requirements.subject.entity,
    );
    const analysis = analyseScenario(interpretation.requirements, catalog);
    await this.ok(p, 'scenario.analyse', {
      environment: meta.environment,
      connectionId,
      details: { interpreter: interpretation.interpreter, summary: analysis.summary },
    });
    return { interpretation, analysis, modelProviderAvailable: !!this.d.interpreter };
  }

  /** Describes a bounded set of tables relevant to a scenario, plus team names. */
  private async scenarioCatalog(connectionId: string, entity: string) {
    const tables = await this.d.records.listTables(connectionId);
    const words = entity
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2)
      .map((w) => w.replace(/s$/, ''));
    const relevant = tables
      .filter((t) => {
        const h = `${t.name} ${t.label}`.toLowerCase();
        return (
          words.some((w) => h.includes(w)) ||
          /employee|people|person|contact|staff|team|group|template|workflow|approval|task/.test(h)
        );
      })
      .slice(0, 15);
    const schemas = await this.d.records.schemas(
      connectionId,
      relevant.map((t) => t.name),
    );
    const teamTable = [...schemas.values()].find(
      (t) => /\bteam/.test(`${t.name} ${t.label}`.toLowerCase()) && !/template/.test(t.name),
    );
    let teamNames: string[] = [];
    const nameField = teamTable?.fields.find((f) => f.name === 'name' || f.name === 'team_name');
    if (teamTable && nameField) {
      const res = await this.d.records
        .search(connectionId, { table: teamTable.name, fields: [nameField.name], pageSize: 100 })
        .catch(() => null);
      teamNames =
        res?.records.map((r) => String(r.fields[nameField.name] ?? '')).filter(Boolean) ?? [];
    }
    return { tables: [...schemas.values()], teamNames };
  }

  async createPlanFromScenario(
    p: Principal,
    connectionId: string,
    input: z.input<typeof ScenarioInputSchema>,
  ) {
    const meta = await this.connEnv(connectionId);
    await this.authorize(p, 'plans:write', {
      environment: meta.environment,
      action: 'plans.create',
      connectionId,
    });
    const { analysis } = await this.analyseScenario(p, connectionId, input);
    const content = planFromScenario(
      analysis,
      this.target(meta),
      (input as { text?: string }).text,
    );
    return this.afterCreate(
      p,
      await this.d.plans.create(
        connectionId,
        {
          ...content,
          request: { ...content.request, source: p.via === 'mcp' ? 'mcp' : 'scenario' },
        },
        p.userId,
      ),
      'scenario',
    );
  }

  async createPlan(p: Principal, connectionId: string, content: unknown) {
    const meta = await this.connEnv(connectionId);
    await this.authorize(p, 'plans:write', {
      environment: meta.environment,
      action: 'plans.create',
      connectionId,
    });
    const withSource = {
      ...(content as object),
      request: {
        ...((content as { request?: object }).request ?? {}),
        source: p.via === 'mcp' ? 'mcp' : 'console',
      },
    };
    return this.afterCreate(
      p,
      await this.d.plans.create(connectionId, withSource, p.userId),
      'structured',
    );
  }

  async revisePlan(p: Principal, planId: string, content: unknown) {
    const { plan, environment } = await this.planEnv(planId);
    await this.authorize(p, 'plans:write', {
      environment,
      action: 'plans.revise',
      targetType: 'plan',
      targetId: planId,
    });
    return this.failing(
      p,
      'plans.revise',
      { environment, targetType: 'plan', targetId: planId },
      async () => {
        const doc = await this.d.plans.revise(planId, content, p.userId);
        await this.ok(p, 'plans.revise', {
          environment,
          connectionId: plan.connection_id,
          targetType: 'plan',
          targetId: planId,
          details: {
            version: doc.version,
            hash: doc.hash,
            note: 'Previous approvals invalidated.',
          },
        });
        return (await this.d.plans.validate(planId)).document;
      },
    );
  }

  async validatePlan(p: Principal, planId: string) {
    const { environment } = await this.planEnv(planId);
    await this.authorize(p, 'plans:write', {
      environment,
      action: 'plans.validate',
      targetType: 'plan',
      targetId: planId,
    });
    const r = await this.d.plans.validate(planId);
    await this.ok(p, 'plans.validate', {
      environment,
      targetType: 'plan',
      targetId: planId,
      details: {
        valid: r.result.valid,
        errors: r.result.issues.filter((i) => i.severity === 'error').length,
      },
    });
    return r;
  }

  async submitPlan(p: Principal, planId: string) {
    const { environment } = await this.planEnv(planId);
    await this.authorize(p, 'plans:write', {
      environment,
      action: 'plans.submit',
      targetType: 'plan',
      targetId: planId,
    });
    return this.failing(
      p,
      'plans.submit',
      { environment, targetType: 'plan', targetId: planId },
      async () => {
        const doc = await this.d.plans.submit(planId, p.userId);
        await this.ok(p, 'plans.submit', {
          environment,
          targetType: 'plan',
          targetId: planId,
          details: { version: doc.version, hash: doc.hash },
        });
        return doc;
      },
    );
  }

  /** Human approval or rejection. Not reachable from MCP (see principal.ts). */
  async decidePlan(
    p: Principal,
    planId: string,
    input: { decision: 'approved' | 'rejected'; reason: string; version: number; hash: string },
  ) {
    const { environment } = await this.planEnv(planId);
    await this.authorize(p, 'plans:approve', {
      environment,
      action: `plans.${input.decision === 'approved' ? 'approve' : 'reject'}`,
      targetType: 'plan',
      targetId: planId,
    });
    if (p.via !== 'console')
      throw new AppError(
        'FORBIDDEN',
        'Approvals can only be given in the Agiloft Control console.',
      );
    return this.failing(
      p,
      `plans.${input.decision === 'approved' ? 'approve' : 'reject'}`,
      { environment, targetType: 'plan', targetId: planId },
      async () => {
        const doc = await this.d.plans.decide(planId, input, p.userId);
        await this.ok(p, `plans.${input.decision === 'approved' ? 'approve' : 'reject'}`, {
          environment,
          targetType: 'plan',
          targetId: planId,
          details: {
            version: doc.version,
            hash: doc.hash,
            reason: input.reason,
            expiresAt: doc.approval.expiresAt,
          },
        });
        return doc;
      },
    );
  }

  async getPlan(p: Principal, planId: string, version?: number) {
    const { environment } = await this.planEnv(planId);
    await this.authorize(p, 'plans:read', {
      environment,
      action: 'plans.read',
      targetType: 'plan',
      targetId: planId,
    });
    const doc = await this.d.plans.document(planId, version);
    const names = await this.d.users.displayNames([
      doc.createdBy,
      ...(doc.approval.decidedBy ? [doc.approval.decidedBy] : []),
    ]);
    return {
      ...doc,
      createdByName: names.get(doc.createdBy) ?? null,
      approvalDecidedByName: doc.approval.decidedBy
        ? (names.get(doc.approval.decidedBy) ?? null)
        : null,
      versions: await this.d.plans.versions(planId),
    };
  }

  async listPlans(
    p: Principal,
    filter: { status?: PlanStatus[]; environment?: Environment; connectionId?: string } = {},
  ) {
    const list = await this.d.plans.list(filter);
    return list.filter((pl) => checkPermission(p, 'plans:read', pl.environment).ok);
  }

  // -------------------------------------------------------------- executions
  async executePlan(p: Principal, planId: string) {
    const { environment } = await this.planEnv(planId);
    await this.authorize(p, 'executions:run', {
      environment,
      action: 'executions.request',
      targetType: 'plan',
      targetId: planId,
    });
    return this.failing(
      p,
      'executions.request',
      { environment, targetType: 'plan', targetId: planId },
      async () => {
        const exe = await this.d.executions.request(planId, p.userId, p.via);
        await this.ok(p, 'executions.request', {
          environment,
          connectionId: exe.connectionId,
          targetType: 'execution',
          targetId: exe.id,
          details: { planId, version: exe.planVersion, hash: exe.planHash },
        });
        return exe;
      },
    );
  }

  async cancelExecution(p: Principal, executionId: string) {
    const exe = await this.d.executions.row(executionId);
    await this.authorize(p, 'executions:cancel', {
      environment: exe.environment as Environment,
      action: 'executions.cancel',
      targetType: 'execution',
      targetId: executionId,
    });
    const v = await this.d.executions.cancel(executionId, p.userId);
    await this.ok(p, 'executions.cancel', {
      environment: exe.environment,
      targetType: 'execution',
      targetId: executionId,
    });
    return v;
  }

  async getExecution(p: Principal, executionId: string) {
    const exe = await this.d.executions.row(executionId);
    await this.authorize(p, 'executions:read', {
      environment: exe.environment as Environment,
      action: 'executions.read',
      targetType: 'execution',
      targetId: executionId,
    });
    return this.d.executions.get(executionId);
  }

  async executionForPlan(p: Principal, planId: string) {
    const { environment } = await this.planEnv(planId);
    await this.authorize(p, 'executions:read', {
      environment,
      action: 'executions.read',
      targetType: 'plan',
      targetId: planId,
    });
    return this.d.executions.forPlan(planId);
  }

  async listExecutions(p: Principal, filter: { environment?: string } = {}) {
    const list = await this.d.executions.list(filter);
    return list.filter(
      (e) => checkPermission(p, 'executions:read', e.environment as Environment).ok,
    );
  }

  // ------------------------------------------------------------------- audit
  async auditEvents(p: Principal, q: AuditQuery) {
    if (q.environment)
      await this.authorize(p, 'audit:read', {
        environment: EnvironmentSchema.parse(q.environment),
        action: 'audit.read',
      });
    const allowedEnvs = ENVIRONMENTS.filter((e) => checkPermission(p, 'audit:read', e).ok);
    if (!allowedEnvs.length) await this.authorize(p, 'audit:read', { action: 'audit.read' });
    const events = await this.d.audit.query(q);
    // Events without an environment (e.g. sign-ins) are visible to global auditors only.
    const global = checkPermission(p, 'audit:read').ok;
    return events.filter((e) =>
      e.environment ? allowedEnvs.includes(e.environment as Environment) : global,
    );
  }

  async exportAudit(p: Principal, q: AuditQuery) {
    await this.authorize(p, 'audit:export', { action: 'audit.export' });
    const events = await this.d.audit.query({ ...q, limit: Math.min(q.limit ?? 500, 500) });
    await this.ok(p, 'audit.export', { details: { filters: q, count: events.length } });
    return AuditService.toCsv(events);
  }

  // ---------------------------------------------------------------- settings
  async policies(p: Principal) {
    await this.authorize(p, 'settings:read', { action: 'settings.read' });
    return this.d.policies.list();
  }

  async updatePolicy(
    p: Principal,
    environment: Environment,
    patch: Partial<Omit<EnvironmentPolicy, 'environment' | 'updatedAt'>>,
  ) {
    await this.authorize(p, 'settings:manage', { environment, action: 'policies.update' });
    const before = await this.d.policies.get(environment);
    const after = await this.d.policies.update(environment, patch, p.userId);
    await this.ok(p, 'policies.update', {
      environment,
      targetType: 'policy',
      targetId: environment,
      details: { before, after },
    });
    return after;
  }

  async users(p: Principal) {
    await this.authorize(p, 'users:manage', { action: 'users.list' });
    return this.d.users.list();
  }

  async setUserRoles(p: Principal, userId: string, roles: { role: string; environment: string }[]) {
    await this.authorize(p, 'users:manage', { action: 'users.roles' });
    const parsed = roles.map((r) => ({
      role: RoleSchema.parse(r.role),
      environment: r.environment === '*' ? ('*' as const) : EnvironmentSchema.parse(r.environment),
    }));
    if (userId === p.userId && !parsed.some((r) => r.role === 'admin' && r.environment === '*')) {
      throw new AppError(
        'VALIDATION_FAILED',
        'You cannot remove your own global administrator role.',
      );
    }
    await this.d.users.setRoles(userId, parsed);
    await this.ok(p, 'users.roles', {
      targetType: 'user',
      targetId: userId,
      details: { roles: parsed },
    });
    return this.d.users.list();
  }

  async systemInfo(p: Principal) {
    await this.authorize(p, 'settings:read', { action: 'settings.read' });
    const c = this.d.config;
    return {
      authMode: c.AUTH_MODE,
      demoMode: c.DEMO_MODE,
      database: c.DATABASE_URL.startsWith('pglite:')
        ? 'Embedded PGlite (single process; not for production)'
        : 'PostgreSQL',
      encryptionKey: c.encryptionKeyEphemeral
        ? 'EPHEMERAL: generated at startup. Stored credentials will not survive a restart. Set APP_ENCRYPTION_KEY.'
        : `Configured (key id ${c.APP_ENCRYPTION_KEY_ID})`,
      modelProvider:
        c.MODEL_PROVIDER === 'anthropic'
          ? `Anthropic (${c.ANTHROPIC_MODEL})`
          : 'None (deterministic interpreter and structured form only)',
      auditRetentionDays: c.AUDIT_RETENTION_DAYS,
      allowedHostSuffixes: c.AGILOFT_ALLOWED_HOST_SUFFIXES,
      onPremHosts: c.AGILOFT_ONPREM_HOSTS,
      mcp: {
        stdioCommand: 'pnpm mcp:stdio',
        httpUrl: c.MCP_RESOURCE_URL,
        httpAuth: c.MCP_OAUTH_ISSUER
          ? `OAuth 2.1 bearer tokens from ${c.MCP_OAUTH_ISSUER} (audience ${c.MCP_OAUTH_AUDIENCE ?? c.MCP_RESOURCE_URL})`
          : c.MCP_DEV_TOKEN
            ? 'Development static token (non-production only)'
            : 'Not configured',
      },
      identityModel:
        'Agiloft actions run under each connection’s shared integration identity. Individuals are recorded in the Agiloft Control audit log.',
    };
  }

  // -------------------------------------------------------------- dashboard
  async overview(p: Principal) {
    const connections = await this.listConnections(p);
    const plans = await this.listPlans(p);
    const executions = await this.listExecutions(p);
    const pending = plans.filter((pl) => pl.status === 'awaiting_approval');
    const recent = executions.slice(0, 8);
    const failures = executions
      .filter((e) => e.status === 'failed' || e.status === 'partially_succeeded')
      .slice(0, 5);
    const primary = connections[0];
    return {
      connections: connections.map((c) => ({
        id: c.id,
        name: c.name,
        environment: c.environment,
        mode: c.mode,
        ok: c.lastVerification?.ok ?? null,
        checkedAt: c.lastVerification?.checkedAt ?? null,
        summary: c.lastVerification?.summary ?? 'Not yet verified',
      })),
      capabilitySummary: primary
        ? summariseCapabilities(await this.d.connections.instanceCapabilities(primary.id))
        : summariseCapabilities([]),
      capabilityConnection: primary
        ? { id: primary.id, name: primary.name, mode: primary.mode }
        : null,
      pendingApprovals: pending.slice(0, 8),
      pendingApprovalCount: pending.length,
      recentExecutions: recent,
      recentFailures: failures,
      planCounts: Object.fromEntries(
        [
          'draft',
          'validated',
          'awaiting_approval',
          'approved',
          'executing',
          'succeeded',
          'partially_succeeded',
          'failed',
          'rejected',
          'cancelled',
        ].map((s) => [s, plans.filter((pl) => pl.status === s).length]),
      ),
      dataSource: connections.some((c) => c.mode === 'demo')
        ? 'Includes the synthetic demo connection.'
        : 'Live application data.',
    };
  }

  // -------------------------------------------------------------------- demo
  private async demoConn(p: Principal, connectionId: string, action: string) {
    const meta = await this.connEnv(connectionId);
    if (meta.mode !== 'demo')
      throw new AppError('DEMO_ONLY', 'Demo controls are only available on demo connections.');
    await this.authorize(p, 'demo:control', {
      environment: meta.environment,
      action,
      connectionId,
    });
    return meta;
  }

  async demoState(p: Principal, connectionId: string) {
    await this.demoConn(p, connectionId, 'demo.read');
    return { faults: await this.d.connections.demoStore(connectionId).listFaults() };
  }

  async demoAddFault(
    p: Principal,
    connectionId: string,
    fault: {
      kind: 'reject_next_write' | 'lose_response_after_apply' | 'timeout_before_apply';
      table: string | null;
      operation: 'create' | 'update' | null;
    },
  ) {
    const meta = await this.demoConn(p, connectionId, 'demo.fault');
    const f = await this.d.connections.demoStore(connectionId).addFault(fault);
    await this.ok(p, 'demo.fault', {
      environment: meta.environment,
      connectionId,
      details: f as unknown as Record<string, unknown>,
    });
    return f;
  }

  async demoClearFaults(p: Principal, connectionId: string) {
    await this.demoConn(p, connectionId, 'demo.fault.clear');
    await this.d.connections.demoStore(connectionId).clearFaults();
  }

  /** Simulates another Agiloft user editing a record, to demonstrate stale-plan detection. */
  async demoExternalEdit(
    p: Principal,
    connectionId: string,
    table: string,
    id: string,
    fields: Record<string, unknown>,
  ) {
    const meta = await this.demoConn(p, connectionId, 'demo.external_edit');
    const store = this.d.connections.demoStore(connectionId);
    const row = await store.get(table, id);
    if (!row) throw new AppError('NOT_FOUND', 'Record not found.');
    const updated = await store.update(table, id, {
      ...fields,
      date_updated: new Date().toISOString(),
    });
    await this.ok(p, 'demo.external_edit', {
      environment: meta.environment,
      connectionId,
      targetType: `agiloft:${table}`,
      targetId: id,
      details: { fields: Object.keys(fields) },
    });
    return updated;
  }

  async demoReset(p: Principal, connectionId: string) {
    const meta = await this.demoConn(p, connectionId, 'demo.reset');
    await this.authorize(p, 'settings:manage', {
      environment: meta.environment,
      action: 'demo.reset',
      connectionId,
    });
    await this.d.connections.demoStore(connectionId).reset();
    await this.ok(p, 'demo.reset', { environment: meta.environment, connectionId });
  }

  /** Untrusted framing helper for MCP responses. */
  static untrusted = asUntrusted;
}
