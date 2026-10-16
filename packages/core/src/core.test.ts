import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { AppError } from '@agiloft-control/shared';
import { createApp, type AppContainer } from './app.ts';
import { loadConfig } from './config.ts';
import { createLogger } from './logger.ts';
import { SecretBox } from './crypto.ts';
import type { Principal } from './principal.ts';

let app: AppContainer;
let operator: Principal;
let approver: Principal;
let viewer: Principal;
let admin: Principal;
const CONN = 'conn_demo';

async function principal(email: string, via: Principal['via'] = 'console', scopes?: string[]) {
  const u = await app.users.findByEmail(email);
  return app.users.principalFor(u!.id, via, scopes ? { scopes: new Set(scopes) } : {});
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

beforeEach(async () => {
  const config = loadConfig({
    DATABASE_URL: 'pglite:memory',
    AUTH_MODE: 'dev',
    DEMO_MODE: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  });
  app = await createApp({ config, logger: createLogger('silent') });
  // Fast retries in tests.
  (app.engine as unknown as { opts: { retryBaseMs: number } }).opts.retryBaseMs = 1;
  operator = await principal('oli.operator@demo.local');
  approver = await principal('ana.approver@demo.local');
  viewer = await principal('vic.viewer@demo.local');
  admin = await principal('avery.admin@demo.local');
});

afterEach(async () => {
  await app.close();
});

async function seededPlans() {
  const plans = await app.control.listPlans(operator);
  return {
    scenario: plans.find((p) => p.title.startsWith('Implement'))!,
    update: plans.find((p) => p.title.includes('LR-1004'))!,
  };
}

async function approve(planId: string, who = approver) {
  const doc = await app.control.getPlan(who, planId);
  return app.control.decidePlan(who, planId, {
    decision: 'approved',
    reason: 'Reviewed in test',
    version: doc.version,
    hash: doc.hash,
  });
}

async function runWorker() {
  while (await app.engine.runOnce()) {
    /* drain */
  }
}

describe('seeded demo', () => {
  it('creates a demo connection, verification and plans awaiting approval', async () => {
    const conns = await app.control.listConnections(viewer);
    expect(conns.map((c) => c.id)).toContain(CONN);
    expect(conns[0]!.lastVerification?.results.every((r) => r.synthetic)).toBe(true);
    const { scenario, update } = await seededPlans();
    expect(scenario.status).toBe('awaiting_approval');
    expect(update.status).toBe('awaiting_approval');
  });
});

describe('authorization and approval integrity', () => {
  it('denies approval to viewers and operators, and records the denial', async () => {
    const { update } = await seededPlans();
    const doc = await app.control.getPlan(viewer, update.id);
    await expectCode(
      app.control.decidePlan(viewer, update.id, {
        decision: 'approved',
        reason: 'nope',
        version: doc.version,
        hash: doc.hash,
      }),
      'FORBIDDEN',
    );
    await expectCode(
      app.control.decidePlan(operator, update.id, {
        decision: 'approved',
        reason: 'nope',
        version: doc.version,
        hash: doc.hash,
      }),
      'FORBIDDEN',
    );
    const audit = await app.control.auditEvents(admin, { result: 'denied' });
    expect(audit.some((a) => a.action === 'plans.approve')).toBe(true);
  });

  it('never allows approval through MCP, even for an approver with every scope', async () => {
    const { update } = await seededPlans();
    const mcpApprover = await principal('ana.approver@demo.local', 'mcp', [
      'agiloft:read',
      'agiloft:plan',
      'agiloft:execute',
      'agiloft:audit',
    ]);
    const doc = await app.control.getPlan(mcpApprover, update.id);
    await expectCode(
      app.control.decidePlan(mcpApprover, update.id, {
        decision: 'approved',
        reason: 'ai says ok',
        version: doc.version,
        hash: doc.hash,
      }),
      'FORBIDDEN',
    );
  });

  it('enforces separation of duties', async () => {
    // An admin creates and submits a plan; the same admin cannot approve it.
    const plan = await app.control.prepareRecordUpdate(admin, CONN, {
      table: 'tasks',
      recordId: '502',
      fields: { status: 'Done' },
    });
    await app.control.submitPlan(admin, plan.planId);
    const doc = await app.control.getPlan(admin, plan.planId);
    await expectCode(
      app.control.decidePlan(admin, plan.planId, {
        decision: 'approved',
        reason: 'self',
        version: doc.version,
        hash: doc.hash,
      }),
      'FORBIDDEN',
    );
  });

  it('binds approval to the reviewed version and hash', async () => {
    const { update } = await seededPlans();
    const doc = await app.control.getPlan(approver, update.id);
    await expectCode(
      app.control.decidePlan(approver, update.id, {
        decision: 'approved',
        reason: 'stale view',
        version: doc.version,
        hash: 'a'.repeat(64),
      }),
      'PLAN_CHANGED',
    );
  });

  it('refuses execution without approval', async () => {
    const { update } = await seededPlans();
    await expectCode(app.control.executePlan(operator, update.id), 'APPROVAL_INVALID');
  });

  it('invalidates approval when the plan changes', async () => {
    const { update } = await seededPlans();
    await approve(update.id);
    const doc = await app.control.getPlan(operator, update.id);
    await app.control.revisePlan(operator, update.id, {
      ...doc.content,
      title: 'Edited after approval',
    });
    const after = await app.control.getPlan(operator, update.id);
    expect(after.version).toBe(2);
    expect(after.status).not.toBe('approved');
    await expectCode(app.control.executePlan(operator, update.id), 'APPROVAL_INVALID');
  });

  it('refuses expired approvals', async () => {
    const { update } = await seededPlans();
    await approve(update.id);
    await app.dbHandle.db
      .updateTable('approvals')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('plan_id', '=', update.id)
      .execute();
    await expectCode(app.control.executePlan(operator, update.id), 'APPROVAL_EXPIRED');
  });

  it('detects stored content tampering after approval', async () => {
    const { update } = await seededPlans();
    await approve(update.id);
    const v = await app.dbHandle.db
      .selectFrom('plan_versions')
      .selectAll()
      .where('plan_id', '=', update.id)
      .executeTakeFirstOrThrow();
    const content = v.content as unknown as { operations: { fields: Record<string, unknown> }[] };
    content.operations[0]!.fields.status = 'Approved';
    await app.dbHandle.db
      .updateTable('plan_versions')
      .set({ content: JSON.stringify(content) })
      .where('plan_id', '=', update.id)
      .execute();
    await expectCode(app.control.executePlan(operator, update.id), 'PLAN_CHANGED');
  });

  it('respects environment write policy at execution time', async () => {
    const { update } = await seededPlans();
    await approve(update.id);
    await app.control.updatePolicy(admin, 'demo', { writesEnabled: false });
    await expectCode(app.control.executePlan(operator, update.id), 'POLICY_DENIED');
  });

  it('limits remote MCP tokens to their scopes', async () => {
    const readOnly = await principal('oli.operator@demo.local', 'mcp', ['agiloft:read']);
    await expect(app.control.listTables(readOnly, CONN)).resolves.toBeTruthy();
    await expectCode(
      app.control.prepareRecordUpdate(readOnly, CONN, {
        table: 'tasks',
        recordId: '502',
        fields: { status: 'Done' },
      }),
      'FORBIDDEN',
    );
  });
});

describe('execution', () => {
  it('executes an approved update, records results, and prevents duplicates', async () => {
    const { update } = await seededPlans();
    await approve(update.id);
    const exe = await app.control.executePlan(operator, update.id);
    expect(exe.status).toBe('queued');
    await expectCode(app.control.executePlan(operator, update.id), 'DUPLICATE_EXECUTION');
    await runWorker();
    const done = await app.control.getExecution(viewer, exe.id);
    expect(done.status).toBe('succeeded');
    expect(done.operations[0]).toMatchObject({ status: 'succeeded', recordId: '304' });
    const rec = await app.control.getRecord(viewer, CONN, 'laptop_requests', '304');
    expect(rec.fields.status).toBe('Pending Manager Approval');
    // The simulated "Web" rule fired as a side effect.
    const notes = await app.control.search(viewer, CONN, {
      table: 'notifications',
      filters: [{ field: 'related_ref', op: 'eq', value: 'LR-1004' }],
    });
    expect(notes.records.length).toBe(1);
  });

  it('detects stale records and writes nothing', async () => {
    const { update } = await seededPlans();
    await approve(update.id);
    await app.control.demoExternalEdit(operator, CONN, 'laptop_requests', '304', {
      status: 'Rejected',
    });
    const exe = await app.control.executePlan(operator, update.id);
    await runWorker();
    const done = await app.control.getExecution(viewer, exe.id);
    expect(done.status).toBe('failed');
    expect(done.operations[0]!.error).toMatchObject({ code: 'STALE_RECORD' });
    expect(
      (await app.control.getRecord(viewer, CONN, 'laptop_requests', '304')).fields.status,
    ).toBe('Rejected');
  });

  it('reports partial success without rolling back', async () => {
    const { scenario } = await seededPlans();
    await approve(scenario.id);
    await app.control.demoAddFault(operator, CONN, {
      kind: 'reject_next_write',
      table: 'task_templates',
      operation: 'create',
    });
    const exe = await app.control.executePlan(operator, scenario.id);
    await runWorker();
    const done = await app.control.getExecution(viewer, exe.id);
    expect(done.status).toBe('partially_succeeded');
    const statuses = done.operations.map((o) => o.status);
    expect(statuses).toContain('succeeded');
    expect(statuses).toContain('failed');
    expect(statuses).toContain('skipped');
    expect(done.summary?.guidance).toMatch(/Nothing was rolled back/);
    expect((await app.control.getPlan(viewer, scenario.id)).status).toBe('partially_succeeded');
  });

  it('reconciles an ambiguous create instead of retrying blindly', async () => {
    const { scenario } = await seededPlans();
    await approve(scenario.id);
    await app.control.demoAddFault(operator, CONN, {
      kind: 'lose_response_after_apply',
      table: 'workflow_templates',
      operation: 'create',
    });
    const exe = await app.control.executePlan(operator, scenario.id);
    await runWorker();
    const done = await app.control.getExecution(viewer, exe.id);
    const wf = done.operations.find((o) => o.operationId === 'create-workflow-template')!;
    expect(wf.status).toBe('succeeded');
    expect(wf.result).toMatchObject({ reconciled: true });
    const found = await app.control.search(viewer, CONN, {
      table: 'workflow_templates',
      filters: [{ field: 'name', op: 'contains', value: 'threshold approval' }],
    });
    expect(found.records).toHaveLength(1);
    expect(done.status).toBe('succeeded');
    expect(done.operations.filter((o) => o.status === 'manual').length).toBeGreaterThan(0);
  });

  it('marks an ambiguous create without a reconciliation key as unknown', async () => {
    const plan = await app.control.prepareRecordCreate(operator, CONN, {
      table: 'tasks',
      fields: { title: 'Ad hoc task', status: 'Not Started' },
    });
    await app.control.submitPlan(operator, plan.planId);
    await approve(plan.planId);
    await app.control.demoAddFault(operator, CONN, {
      kind: 'lose_response_after_apply',
      table: 'tasks',
      operation: 'create',
    });
    const exe = await app.control.executePlan(operator, plan.planId);
    await runWorker();
    const done = await app.control.getExecution(viewer, exe.id);
    expect(done.operations[0]!.status).toBe('unknown');
    expect(done.status).toBe('failed');
  });

  it('retries a write that never reached Agiloft', async () => {
    const plan = await app.control.prepareRecordCreate(operator, CONN, {
      table: 'tasks',
      fields: { title: 'Retry me', status: 'Not Started' },
    });
    await app.control.submitPlan(operator, plan.planId);
    await approve(plan.planId);
    await app.control.demoAddFault(operator, CONN, {
      kind: 'timeout_before_apply',
      table: 'tasks',
      operation: 'create',
    });
    const exe = await app.control.executePlan(operator, plan.planId);
    await runWorker();
    const done = await app.control.getExecution(viewer, exe.id);
    expect(done.status).toBe('succeeded');
    expect(done.operations[0]!.attempts).toBe(2);
  });

  it('recovers after a worker crash without duplicating an applied write', async () => {
    const { update } = await seededPlans();
    await approve(update.id);
    const exe = await app.control.executePlan(operator, update.id);
    // Simulate: a worker claimed the job, applied the write, then died before recording the result.
    const adapter = await app.connections.adapter(CONN);
    await adapter.update('laptop_requests', '304', { status: 'Pending Manager Approval' });
    await app.dbHandle.db
      .updateTable('executions')
      .set({
        status: 'executing',
        lease_owner: 'dead-worker',
        lease_expires_at: new Date(Date.now() - 1000),
        run_count: 1,
      })
      .where('id', '=', exe.id)
      .execute();
    await app.dbHandle.db
      .updateTable('execution_operations')
      .set({ status: 'running', attempts: 1 })
      .where('execution_id', '=', exe.id)
      .execute();
    await runWorker();
    const done = await app.control.getExecution(viewer, exe.id);
    expect(done.status).toBe('succeeded');
    expect(done.operations[0]!.result).toMatchObject({ reconciled: true });
    expect(done.operations[0]!.attempts).toBe(1);
    expect(done.events.some((e) => e.message.includes('Resumed'))).toBe(true);
  });

  it('cancels between operations', async () => {
    const { scenario } = await seededPlans();
    await approve(scenario.id);
    const exe = await app.control.executePlan(operator, scenario.id);
    await app.control.cancelExecution(operator, exe.id);
    const done = await app.control.getExecution(viewer, exe.id);
    expect(done.status).toBe('cancelled');
    expect(done.operations.every((o) => o.status === 'cancelled')).toBe(true);
  });

  it('only one worker can claim an execution', async () => {
    const { update } = await seededPlans();
    await approve(update.id);
    await app.control.executePlan(operator, update.id);
    const claim = async () =>
      sql<{
        id: string;
      }>`update executions set lease_owner = 'w', lease_expires_at = now() + interval '60 seconds'
        where id = (select id from executions where status in ('queued','executing') and (lease_expires_at is null or lease_expires_at < now()) limit 1 for update skip locked) returning id`.execute(
        app.dbHandle.db,
      );
    const first = await claim();
    const second = await claim();
    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(0);
  });
});

describe('records and security helpers', () => {
  it('rejects queries the documented syntax cannot express safely', async () => {
    await expectCode(
      app.control.search(viewer, CONN, {
        table: 'employees',
        filters: [{ field: 'full_name', op: 'eq', value: "O'Brien" }],
      }),
      'INVALID_QUERY',
    );
    await expectCode(
      app.control.search(viewer, CONN, {
        table: 'employees',
        filters: [{ field: 'nope', op: 'eq', value: 'x' }],
      }),
      'INVALID_QUERY',
    );
  });

  it('paginates with bounded page size', async () => {
    const page = await app.control.search(viewer, CONN, {
      table: 'employees',
      pageSize: 5,
      page: 1,
    });
    expect(page.records).toHaveLength(5);
    expect(page.total).toBe(11);
    expect(page.hasMore).toBe(true);
    await expect(
      app.control.search(viewer, CONN, { table: 'employees', pageSize: 500 }),
    ).rejects.toThrow();
  });

  it('redacts secrets in audit details', async () => {
    await app.audit.record({
      principal: admin,
      action: 'test',
      result: 'success',
      details: {
        password: 'hunter2',
        note: 'Bearer abc.def.ghi',
        url: 'https://x.agiloft.com/ewws/EWRead?$password=pw',
      },
    });
    const [e] = await app.control.auditEvents(admin, { action: 'test' });
    const s = JSON.stringify(e!.details);
    expect(s).not.toContain('hunter2');
    expect(s).not.toContain('$password=pw');
    expect(s).not.toContain('abc.def.ghi');
  });

  it('encrypts secrets bound to their owner', () => {
    const box = new SecretBox(Buffer.alloc(32, 7), 'k1');
    const sealed = box.seal('{"password":"x"}', 'conn_a');
    expect(sealed).not.toContain('password');
    expect(box.open(sealed, 'conn_a')).toBe('{"password":"x"}');
    expect(() => box.open(sealed, 'conn_b')).toThrow();
  });

  it('blocks unsafe connection URLs', async () => {
    const input = {
      name: 'x',
      environment: 'staging' as const,
      kbName: 'KB',
      auth: { method: 'password_jwt' as const, login: 'a', password: 'b' },
    };
    await expectCode(
      app.control.createConnection(admin, { ...input, baseUrl: 'http://acme.agiloft.com' }),
      'UNSAFE_URL',
    );
    await expectCode(
      app.control.createConnection(admin, { ...input, baseUrl: 'https://169.254.169.254' }),
      'UNSAFE_URL',
    );
    await expectCode(
      app.control.createConnection(admin, { ...input, baseUrl: 'https://evil.example.com' }),
      'UNSAFE_URL',
    );
    await expectCode(
      app.control.createConnection(admin, {
        ...input,
        baseUrl: 'https://user:pw@acme.agiloft.com',
      }),
      'UNSAFE_URL',
    );
  });

  it('keeps prompt-injection text in records as plain data', async () => {
    const rec = await app.control.getRecord(viewer, CONN, 'laptop_requests', '304');
    expect(String(rec.fields.justification)).toContain('ignore previous instructions');
    // Reading it changes nothing: plans remain awaiting approval.
    const { update } = await seededPlans();
    expect(update.status).toBe('awaiting_approval');
  });
});
