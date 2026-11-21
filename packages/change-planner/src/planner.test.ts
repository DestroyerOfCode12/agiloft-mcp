import { describe, expect, it } from 'vitest';
import { DEMO_TABLES, LAPTOP_SCENARIO_TEXT, DEMO_RECORDS } from '@agiloft-control/test-fixtures';
import {
  analyseScenario,
  interpretDeterministically,
  orderOperations,
  planFromScenario,
  validatePlan,
  buildRecordUpdatePlan,
} from './index.ts';
import type { ValidationContext } from './validate.ts';

const target = {
  connectionId: 'conn_demo',
  environment: 'demo' as const,
  kbName: 'AcmeDemo',
  instanceLabel: 'demo',
};
const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  connection: { id: 'conn_demo', environment: 'demo' },
  schemas: new Map(DEMO_TABLES.map((t) => [t.name, t])),
  instanceCapabilities: [],
  policy: { writesEnabled: true, allowedWriteTables: null },
  ...over,
});
const teamNames = DEMO_RECORDS.teams!.map((t) => String(t.name));

describe('deterministic interpretation', () => {
  it('extracts the laptop scenario', () => {
    const r = interpretDeterministically(LAPTOP_SCENARIO_TEXT);
    expect(r.requirements.subject.entity).toBe('laptop request');
    expect(r.requirements.trigger.event).toBe('submitted');
    expect(r.requirements.approvals).toHaveLength(2);
    expect(r.requirements.approvals[0]).toMatchObject({
      approverSource: 'requester_manager',
      order: 1,
    });
    expect(r.requirements.approvals[1]).toMatchObject({
      team: 'Finance',
      threshold: { op: 'gt', amount: 20000, currency: 'ZAR' },
    });
    expect(r.requirements.tasks?.when).toBe('after_approval');
    expect(r.requirements.notifications[0]?.audience).toBe('requester');
    expect(r.requirements.escalations[0]?.target).toBe('overdue_tasks');
  });
});

describe('scenario analysis', () => {
  const req = interpretDeterministically(LAPTOP_SCENARIO_TEXT).requirements;
  const analysis = analyseScenario(req, { tables: DEMO_TABLES, teamNames });

  it('maps to discovered tables and fields without inventing them', () => {
    expect(analysis.mapping).toMatchObject({
      subjectTable: 'laptop_requests',
      amountField: 'amount',
      requesterField: 'requester',
      managerField: 'manager',
      templateTables: {
        workflow: 'workflow_templates',
        approval: 'approval_templates',
        task: 'task_templates',
      },
    });
  });

  it('covers every planning category', () => {
    const cats = new Set(analysis.steps.map((s) => s.category));
    for (const c of [
      'trigger',
      'tables_fields',
      'conditions',
      'approver_resolution',
      'approval_order',
      'tasks',
      'notifications',
      'deadlines',
      'escalations',
      'permissions',
      'audit',
      'failure_retry',
      'test_cases',
    ]) {
      expect(cats.has(c as never), c).toBe(true);
    }
  });

  it('never fabricates a business calendar', () => {
    expect(analysis.unknowns.some((u) => u.id === 'u-calendar')).toBe(true);
  });

  it('produces a valid plan whose rules remain manual', () => {
    const plan = planFromScenario(analysis, target, LAPTOP_SCENARIO_TEXT);
    const result = validatePlan(plan, ctx());
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(plan.operations.find((o) => o.id === 'configure-rules')?.route).toBe('manual_admin');
    expect(plan.operations.filter((o) => o.kind === 'record.create').length).toBeGreaterThanOrEqual(
      4,
    );
  });

  it('marks missing approvers as blocking when the schema lacks them', () => {
    const tables = DEMO_TABLES.map((t) =>
      t.name === 'employees' ? { ...t, fields: t.fields.filter((f) => f.name !== 'manager') } : t,
    );
    const a = analyseScenario(req, { tables, teamNames });
    expect(a.unknowns.find((u) => u.id.startsWith('u-approver-manager'))?.blocking).toBe(true);
    const v = validatePlan(
      planFromScenario(a, target),
      ctx({ schemas: new Map(tables.map((t) => [t.name, t])) }),
    );
    expect(v.valid).toBe(false);
  });
});

describe('validation', () => {
  const base = planFromScenario(
    analyseScenario(interpretDeterministically(LAPTOP_SCENARIO_TEXT).requirements, {
      tables: DEMO_TABLES,
      teamNames,
    }),
    target,
  );

  it('rejects cross-environment plans', () => {
    const v = validatePlan(
      base,
      ctx({ connection: { id: 'conn_demo', environment: 'production' } }),
    );
    expect(v.issues.map((i) => i.code)).toContain('ENVIRONMENT_MISMATCH');
  });

  it('blocks writes when environment policy disables them', () => {
    const v = validatePlan(
      base,
      ctx({ policy: { writesEnabled: false, allowedWriteTables: null } }),
    );
    expect(v.issues.map((i) => i.code)).toContain('WRITES_DISABLED');
  });

  it('rejects an admin_api route because none is verified', () => {
    const plan = {
      ...base,
      operations: [
        ...base.operations,
        { ...base.operations[0]!, id: 'x-admin', route: 'admin_api' as const },
      ],
    };
    expect(validatePlan(plan, ctx()).issues.map((i) => i.code)).toContain('NO_ADMIN_API');
  });

  it('rejects automated operations that wait on manual ones', () => {
    const plan = {
      ...base,
      operations: [
        ...base.operations,
        {
          ...base.operations[0]!,
          id: 'late-create',
          dependsOn: ['configure-rules'],
          reconcileBy: undefined,
        },
      ],
    };
    expect(validatePlan(plan, ctx()).issues.map((i) => i.code)).toContain('AUTOMATED_AFTER_MANUAL');
  });

  it('rejects unknown fields and invalid choices', () => {
    const plan = {
      ...base,
      operations: [
        {
          id: 'c',
          kind: 'record.create',
          title: 'x',
          route: 'config_records',
          table: 'tasks',
          fields: { title: 'x', nope: 1, status: 'Weird' },
        },
      ],
    };
    const codes = validatePlan(plan, ctx()).issues.map((i) => i.code);
    expect(codes).toContain('UNKNOWN_FIELD');
    expect(codes).toContain('INVALID_CHOICE');
  });

  it('requires captured before-values for updates', () => {
    const plan = {
      ...base,
      operations: [
        {
          id: 'u',
          kind: 'record.update',
          title: 'x',
          route: 'config_records',
          table: 'tasks',
          recordId: '501',
          fields: { status: 'Done' },
        },
      ],
    };
    expect(validatePlan(plan, ctx()).issues.map((i) => i.code)).toContain('MISSING_BEFORE_VALUES');
  });

  it('builds update plans with before values and date_updated', () => {
    const table = DEMO_TABLES.find((t) => t.name === 'tasks')!;
    const plan = buildRecordUpdatePlan({
      target,
      table,
      current: {
        id: '502',
        fields: { status: 'In Progress', date_updated: '2026-09-08T09:00:00.000Z' },
      },
      fields: { status: 'Done' },
      source: 'mcp',
    });
    expect(plan.operations[0]).toMatchObject({
      before: { status: 'In Progress' },
      expected: { dateUpdated: '2026-09-08T09:00:00.000Z' },
    });
    expect(validatePlan(plan, ctx()).valid).toBe(true);
  });
});

describe('ordering', () => {
  it('orders deterministically and detects cycles', () => {
    expect(
      orderOperations([
        { id: 'b', dependsOn: ['a'] },
        { id: 'a', dependsOn: [] },
        { id: 'c', dependsOn: [] },
      ]).order,
    ).toEqual(['a', 'b', 'c']);
    expect(
      orderOperations([
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['a'] },
      ]).errors[0]?.code,
    ).toBe('DEPENDENCY_CYCLE');
  });
});
