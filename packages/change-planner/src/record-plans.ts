import {
  ChangePlanContentSchema,
  PLAN_SCHEMA_VERSION,
  type AgiloftRecord,
  type ChangePlanContent,
  type FieldValue,
  type TableSchema,
} from '@agiloft-control/shared';
import type { ScenarioTarget } from './scenario.ts';

const RULE_SIDE_EFFECT =
  'Agiloft event rules on this table that include the "Web" modification type may run, possibly sending emails or changing other records. These effects cannot be listed through a documented API and may not be reversible.';

const DATE_UPDATED = 'date_updated';

function common(target: ScenarioTarget, title: string, source: 'mcp' | 'console', opIds: string[]) {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    title,
    target,
    request: { source },
    sideEffects: [
      { id: 'se-rules', description: RULE_SIDE_EFFECT, reversible: false, operationIds: opIds },
    ],
    validationSteps: [
      {
        id: 'v-read-back',
        description:
          'The record is read back after the write and compared with the requested values.',
        operationIds: opIds,
      },
    ],
  };
}

export function buildRecordCreatePlan(args: {
  target: ScenarioTarget;
  table: TableSchema;
  fields: Record<string, FieldValue>;
  reconcileBy?: { field: string; value: string };
  title?: string;
  reason?: string;
  source: 'mcp' | 'console';
}): ChangePlanContent {
  const opId = 'create-record';
  return ChangePlanContentSchema.parse({
    ...common(args.target, args.title ?? `Create ${args.table.label} record`, args.source, [opId]),
    summary: args.reason ?? '',
    assumptions: args.reconcileBy
      ? []
      : [
          {
            id: 'a-no-reconcile',
            text: 'No unique field was supplied, so a lost response cannot be reconciled automatically.',
            source: 'planner',
          },
        ],
    preconditions: [
      {
        id: 'p-table',
        description: `Table "${args.table.name}" exists`,
        kind: 'table_exists',
        table: args.table.name,
      },
    ],
    operations: [
      {
        id: opId,
        kind: 'record.create',
        title: `Create ${args.table.label} record`,
        route: 'config_records',
        table: args.table.name,
        fields: args.fields,
        ...(args.reconcileBy ? { reconcileBy: args.reconcileBy } : {}),
        risk: 'medium',
        sideEffects: [RULE_SIDE_EFFECT],
        compensation:
          'Delete or correct the record in the Agiloft UI. Deletion is not exposed by Agiloft Control.',
        capabilityIds: ['records.create'],
      },
    ],
    recovery: {
      strategy: 'Manual correction in Agiloft.',
      compensatingActions: [
        {
          operationId: opId,
          description: 'Delete or correct the created record in the Agiloft UI.',
          automated: false,
        },
      ],
      limits: ['Side effects of triggered rules cannot be undone.'],
    },
  });
}

/**
 * Builds an update plan from the record as it is now, capturing before values
 * for every changed field plus date_updated for the freshness check.
 */
export function buildRecordUpdatePlan(args: {
  target: ScenarioTarget;
  table: TableSchema;
  current: AgiloftRecord;
  fields: Record<string, FieldValue>;
  title?: string;
  reason?: string;
  source: 'mcp' | 'console';
}): ChangePlanContent {
  const opId = 'update-record';
  const before: Record<string, unknown> = {};
  for (const name of Object.keys(args.fields)) before[name] = args.current.fields[name] ?? null;
  const dateUpdated = args.current.fields[DATE_UPDATED];
  return ChangePlanContentSchema.parse({
    ...common(
      args.target,
      args.title ?? `Update ${args.table.label} #${args.current.id}`,
      args.source,
      [opId],
    ),
    summary: args.reason ?? '',
    preconditions: [
      {
        id: 'p-record',
        description: `Record ${args.current.id} exists in "${args.table.name}"`,
        kind: 'record_exists',
        table: args.table.name,
        recordId: args.current.id,
      },
    ],
    operations: [
      {
        id: opId,
        kind: 'record.update',
        title: `Update ${args.table.label} #${args.current.id}`,
        route: 'config_records',
        table: args.table.name,
        recordId: args.current.id,
        fields: args.fields,
        before,
        expected: { dateUpdated: dateUpdated == null ? null : String(dateUpdated) },
        risk: 'medium',
        sideEffects: [RULE_SIDE_EFFECT],
        compensation: 'Prepare a new plan restoring the "before" values shown in this plan.',
        capabilityIds: ['records.update'],
      },
    ],
    recovery: {
      strategy: 'Restore previous values with a new reviewed plan.',
      compensatingActions: [
        {
          operationId: opId,
          description: 'Create a follow-up plan that sets the captured before values.',
          automated: false,
        },
      ],
      limits: ['Side effects of triggered rules cannot be undone by restoring values.'],
    },
  });
}
