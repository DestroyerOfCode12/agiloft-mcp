import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { EnvironmentSchema, PlanStatusSchema } from '@agiloft-control/shared';
import type { AppContainer } from '@agiloft-control/core';
import { requirePrincipal } from './auth.ts';

const Id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const params = <T extends z.ZodRawShape>(shape: T) => z.object(shape);

/**
 * Console REST API. Each handler resolves the session principal and calls the
 * shared AgiloftControl service, which performs authorization, policy checks
 * and auditing; routes contain no business rules of their own.
 */
export function registerRoutes(f: FastifyInstance, app: AppContainer) {
  const c = app.control;

  f.get('/api/overview', async (req) => c.overview(requirePrincipal(req)));

  // ------------------------------------------------------------ connections
  f.get('/api/connections', async (req) => c.listConnections(requirePrincipal(req)));
  f.post('/api/connections', async (req) =>
    c.createConnection(requirePrincipal(req), req.body as never),
  );
  f.get('/api/connections/:id', async (req) =>
    c.getConnection(requirePrincipal(req), params({ id: Id }).parse(req.params).id),
  );
  f.patch('/api/connections/:id', async (req) =>
    c.updateConnection(
      requirePrincipal(req),
      params({ id: Id }).parse(req.params).id,
      z.record(z.string(), z.unknown()).parse(req.body),
    ),
  );
  f.post('/api/connections/:id/test', async (req) =>
    c.testConnection(requirePrincipal(req), params({ id: Id }).parse(req.params).id),
  );

  f.get('/api/capabilities', async (req) => {
    const q = z.object({ connectionId: Id.optional() }).parse(req.query);
    return c.capabilities(requirePrincipal(req), q.connectionId);
  });

  // ---------------------------------------------------------- schema/records
  f.get('/api/connections/:id/tables', async (req) => {
    const { id } = params({ id: Id }).parse(req.params);
    const { search } = z.object({ search: z.string().max(80).optional() }).parse(req.query);
    return c.listTables(requirePrincipal(req), id, search);
  });
  f.get('/api/connections/:id/tables/:table', async (req) => {
    const p = params({ id: Id, table: z.string().max(128) }).parse(req.params);
    return c.describeTable(requirePrincipal(req), p.id, p.table);
  });
  f.post('/api/connections/:id/search', async (req) =>
    c.search(requirePrincipal(req), params({ id: Id }).parse(req.params).id, req.body as never),
  );
  f.get('/api/connections/:id/tables/:table/records/:rid', async (req) => {
    const p = params({ id: Id, table: z.string().max(128), rid: z.string().max(18) }).parse(
      req.params,
    );
    return c.getRecord(requirePrincipal(req), p.id, p.table, p.rid);
  });
  f.get('/api/connections/:id/tables/:table/records/:rid/related', async (req) => {
    const p = params({ id: Id, table: z.string().max(128), rid: z.string().max(18) }).parse(
      req.params,
    );
    return c.relatedRecords(requirePrincipal(req), p.id, p.table, p.rid);
  });

  // ------------------------------------------------------------------ plans
  f.post('/api/connections/:id/scenario/analyse', async (req) =>
    c.analyseScenario(
      requirePrincipal(req),
      params({ id: Id }).parse(req.params).id,
      req.body as never,
    ),
  );
  f.post('/api/connections/:id/scenario/plan', async (req) =>
    c.createPlanFromScenario(
      requirePrincipal(req),
      params({ id: Id }).parse(req.params).id,
      req.body as never,
    ),
  );
  f.post('/api/connections/:id/plans/prepare-create', async (req) =>
    c.prepareRecordCreate(
      requirePrincipal(req),
      params({ id: Id }).parse(req.params).id,
      req.body as never,
    ),
  );
  f.post('/api/connections/:id/plans/prepare-update', async (req) =>
    c.prepareRecordUpdate(
      requirePrincipal(req),
      params({ id: Id }).parse(req.params).id,
      req.body as never,
    ),
  );
  f.post('/api/connections/:id/plans', async (req) =>
    c.createPlan(requirePrincipal(req), params({ id: Id }).parse(req.params).id, req.body),
  );

  f.get('/api/plans', async (req) => {
    const q = z
      .object({ status: z.string().optional(), environment: EnvironmentSchema.optional() })
      .parse(req.query);
    const status = q.status ? q.status.split(',').map((s) => PlanStatusSchema.parse(s)) : undefined;
    return c.listPlans(requirePrincipal(req), { status, environment: q.environment });
  });
  f.get('/api/plans/:id', async (req) => {
    const { id } = params({ id: Id }).parse(req.params);
    const { version } = z
      .object({ version: z.coerce.number().int().min(1).optional() })
      .parse(req.query);
    return c.getPlan(requirePrincipal(req), id, version);
  });
  f.put('/api/plans/:id', async (req) =>
    c.revisePlan(requirePrincipal(req), params({ id: Id }).parse(req.params).id, req.body),
  );
  f.post('/api/plans/:id/validate', async (req) =>
    c.validatePlan(requirePrincipal(req), params({ id: Id }).parse(req.params).id),
  );
  f.post('/api/plans/:id/submit', async (req) =>
    c.submitPlan(requirePrincipal(req), params({ id: Id }).parse(req.params).id),
  );
  f.post('/api/plans/:id/decision', async (req) =>
    c.decidePlan(requirePrincipal(req), params({ id: Id }).parse(req.params).id, req.body as never),
  );
  f.post('/api/plans/:id/execute', async (req) =>
    c.executePlan(requirePrincipal(req), params({ id: Id }).parse(req.params).id),
  );
  f.get(
    '/api/plans/:id/execution',
    async (req) =>
      (await c.executionForPlan(
        requirePrincipal(req),
        params({ id: Id }).parse(req.params).id,
      )) ?? { status: 'not_executed' },
  );

  // -------------------------------------------------------------- executions
  f.get('/api/executions', async (req) => {
    const q = z.object({ environment: EnvironmentSchema.optional() }).parse(req.query);
    return c.listExecutions(requirePrincipal(req), q);
  });
  f.get('/api/executions/:id', async (req) =>
    c.getExecution(requirePrincipal(req), params({ id: Id }).parse(req.params).id),
  );
  f.post('/api/executions/:id/cancel', async (req) =>
    c.cancelExecution(requirePrincipal(req), params({ id: Id }).parse(req.params).id),
  );

  // ------------------------------------------------------------------- audit
  const AuditQuery = z.object({
    actor: z.string().max(120).optional(),
    environment: EnvironmentSchema.optional(),
    action: z.string().max(80).optional(),
    result: z.enum(['success', 'denied', 'failure']).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  });
  f.get('/api/audit', async (req) =>
    c.auditEvents(requirePrincipal(req), AuditQuery.parse(req.query)),
  );
  f.get('/api/audit/export', async (req, reply) => {
    const csv = await c.exportAudit(requirePrincipal(req), AuditQuery.parse(req.query));
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="agiloft-control-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
    return csv;
  });

  // ---------------------------------------------------------------- settings
  f.get('/api/settings/policies', async (req) => c.policies(requirePrincipal(req)));
  f.patch('/api/settings/policies/:env', async (req) => {
    const { env } = params({ env: EnvironmentSchema }).parse(req.params);
    const patch = z
      .object({
        writesEnabled: z.boolean().optional(),
        requireSeparationOfDuties: z.boolean().optional(),
        approvalTtlMinutes: z
          .number()
          .int()
          .min(5)
          .max(7 * 24 * 60)
          .optional(),
        allowedWriteTables: z.array(z.string().max(128)).max(200).nullable().optional(),
        useRecordLocks: z.boolean().optional(),
      })
      .parse(req.body);
    return c.updatePolicy(requirePrincipal(req), env, patch);
  });
  f.get('/api/settings/users', async (req) => c.users(requirePrincipal(req)));
  f.put('/api/settings/users/:id/roles', async (req) => {
    const { id } = params({ id: Id }).parse(req.params);
    const { roles } = z
      .object({ roles: z.array(z.object({ role: z.string(), environment: z.string() })).max(20) })
      .parse(req.body);
    return c.setUserRoles(requirePrincipal(req), id, roles);
  });
  f.get('/api/settings/system', async (req) => c.systemInfo(requirePrincipal(req)));

  // -------------------------------------------------------------------- demo
  f.get('/api/connections/:id/demo', async (req) =>
    c.demoState(requirePrincipal(req), params({ id: Id }).parse(req.params).id),
  );
  f.post('/api/connections/:id/demo/faults', async (req) => {
    const body = z
      .object({
        kind: z.enum(['reject_next_write', 'lose_response_after_apply', 'timeout_before_apply']),
        table: z.string().max(128).nullable().default(null),
        operation: z.enum(['create', 'update']).nullable().default(null),
      })
      .parse(req.body);
    return c.demoAddFault(requirePrincipal(req), params({ id: Id }).parse(req.params).id, body);
  });
  f.delete('/api/connections/:id/demo/faults', async (req) => {
    await c.demoClearFaults(requirePrincipal(req), params({ id: Id }).parse(req.params).id);
    return { ok: true };
  });
  f.post('/api/connections/:id/demo/external-edit', async (req) => {
    const body = z
      .object({
        table: z.string().max(128),
        recordId: z.string().max(18),
        fields: z.record(z.string(), z.unknown()),
      })
      .parse(req.body);
    return c.demoExternalEdit(
      requirePrincipal(req),
      params({ id: Id }).parse(req.params).id,
      body.table,
      body.recordId,
      body.fields,
    );
  });
  f.post('/api/connections/:id/demo/reset', async (req) => {
    await c.demoReset(requirePrincipal(req), params({ id: Id }).parse(req.params).id);
    return { ok: true };
  });
}
