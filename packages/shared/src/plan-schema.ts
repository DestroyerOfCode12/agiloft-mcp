import { z } from 'zod';
import { EnvironmentSchema } from './environments.ts';
import { LOGICAL_NAME, RecordIdSchema } from './agiloft-schema.ts';

export const PLAN_SCHEMA_VERSION = 'agiloft-control/change-plan@1' as const;

export const ImplementationRouteSchema = z.enum([
  'native_existing',
  'config_records',
  'admin_api',
  'external_orchestration',
  'manual_admin',
  'unsupported',
]);
export type ImplementationRoute = z.infer<typeof ImplementationRouteSchema>;

export const ROUTE_LABELS: Record<ImplementationRoute, string> = {
  native_existing: 'Existing native configuration',
  config_records: 'Editable configuration records',
  admin_api: 'Verified administration API',
  external_orchestration: 'External orchestration',
  manual_admin: 'Manual administrator configuration',
  unsupported: 'Unsupported or awaiting verification',
};

export const OperationKindSchema = z.enum([
  'record.create',
  'record.update',
  'verify.read',
  'manual.configure',
  'external.orchestrate',
]);
export type OperationKind = z.infer<typeof OperationKindSchema>;

export const AUTOMATED_KINDS: readonly OperationKind[] = [
  'record.create',
  'record.update',
  'verify.read',
];
export const WRITE_KINDS: readonly OperationKind[] = ['record.create', 'record.update'];

const fieldName = z.string().regex(LOGICAL_NAME, 'Field names must be Agiloft logical names');

/**
 * A field value. Linked fields use Query-By-Example, which is the documented
 * REST mechanism for linking by imported column value.
 */
export const FieldValueSchema = z.union([
  z.string().max(20_000),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(2_000)).max(200),
  z.object({
    /** Link by the value of the imported column named by the field key; `table` is required only for multi-table links. */
    qbe: z.object({
      table: z.string().regex(LOGICAL_NAME).optional(),
      value: z.string().min(1).max(2_000),
    }),
  }),
]);
export type FieldValue = z.infer<typeof FieldValueSchema>;

export const RiskLevelSchema = z.enum(['low', 'medium', 'high']);

export const OperationSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Operation IDs are short kebab-case identifiers'),
  kind: OperationKindSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(4_000).optional(),
  route: ImplementationRouteSchema,
  dependsOn: z.array(z.string()).default([]),
  table: z.string().regex(LOGICAL_NAME).optional(),
  recordId: RecordIdSchema.optional(),
  fields: z.record(fieldName, FieldValueSchema).optional(),
  /** Values observed when the plan was prepared; used for freshness checks. */
  before: z.record(z.string(), z.json()).optional(),
  expected: z
    .object({
      dateUpdated: z.string().optional(),
    })
    .optional(),
  /** For creates: a unique field that allows reconciliation after an ambiguous failure. */
  reconcileBy: z.object({ field: fieldName, value: z.string().min(1).max(500) }).optional(),
  risk: RiskLevelSchema.default('medium'),
  sideEffects: z.array(z.string().max(1_000)).default([]),
  irreversible: z.boolean().default(false),
  irreversibleReason: z.string().max(1_000).optional(),
  compensation: z.string().max(2_000).optional(),
  manualInstructions: z.array(z.string().max(2_000)).optional(),
  capabilityIds: z.array(z.string()).default([]),
});
export type Operation = z.infer<typeof OperationSchema>;
export type OperationInput = z.input<typeof OperationSchema>;

export const ScenarioCategorySchema = z.enum([
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
]);
export type ScenarioCategory = z.infer<typeof ScenarioCategorySchema>;

export const ScenarioStepSchema = z.object({
  id: z.string(),
  category: ScenarioCategorySchema,
  title: z.string(),
  detail: z.string(),
  route: ImplementationRouteSchema,
  routeRationale: z.string(),
  status: z.enum(['resolved', 'needs_input', 'unsupported']),
  operationIds: z.array(z.string()).default([]),
  unknownIds: z.array(z.string()).default([]),
  operationalNotes: z.array(z.string()).default([]),
});
export type ScenarioStep = z.infer<typeof ScenarioStepSchema>;

export const UnknownSchema = z.object({
  id: z.string(),
  question: z.string(),
  impact: z.string(),
  blocking: z.boolean(),
});
export type Unknown = z.infer<typeof UnknownSchema>;

export const PreconditionSchema = z.object({
  id: z.string(),
  description: z.string(),
  kind: z.enum([
    'table_exists',
    'field_exists',
    'record_exists',
    'capability_verified',
    'writes_enabled',
    'manual',
  ]),
  table: z.string().optional(),
  field: z.string().optional(),
  recordId: z.string().optional(),
  capabilityId: z.string().optional(),
});
export type Precondition = z.infer<typeof PreconditionSchema>;

export const CapabilityEvidenceRefSchema = z.object({
  capabilityId: z.string(),
  docStatus: z.enum(['verified', 'unverified', 'unsupported', 'restricted']),
  instanceStatus: z.enum(['verified', 'unverified', 'unsupported', 'restricted', 'not_checked']),
  evidenceUrl: z.string().nullable(),
  checkedAt: z.string().nullable(),
});

export const ChangePlanContentSchema = z.object({
  schemaVersion: z.literal(PLAN_SCHEMA_VERSION),
  title: z.string().min(1).max(200),
  summary: z.string().max(8_000).default(''),
  target: z.object({
    connectionId: z.string(),
    environment: EnvironmentSchema,
    kbName: z.string(),
    instanceLabel: z.string(),
  }),
  request: z.object({
    source: z.enum(['mcp', 'console', 'scenario']),
    text: z.string().max(20_000).optional(),
    structured: z.json().optional(),
  }),
  assumptions: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        source: z.enum(['user', 'schema', 'planner', 'default']),
      }),
    )
    .default([]),
  unknowns: z.array(UnknownSchema).default([]),
  capabilityEvidence: z.array(CapabilityEvidenceRefSchema).default([]),
  preconditions: z.array(PreconditionSchema).default([]),
  operations: z.array(OperationSchema).min(1).max(200),
  sideEffects: z
    .array(
      z.object({
        id: z.string(),
        description: z.string(),
        reversible: z.boolean(),
        operationIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  validationSteps: z
    .array(
      z.object({
        id: z.string(),
        description: z.string(),
        operationIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  recovery: z
    .object({
      strategy: z.string(),
      compensatingActions: z
        .array(
          z.object({ operationId: z.string(), description: z.string(), automated: z.boolean() }),
        )
        .default([]),
      limits: z.array(z.string()).default([]),
    })
    .default({ strategy: 'Manual review', compensatingActions: [], limits: [] }),
  testCases: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        given: z.string(),
        when: z.string(),
        then: z.string(),
      }),
    )
    .default([]),
  scenarioSteps: z.array(ScenarioStepSchema).default([]),
});
export type ChangePlanContent = z.infer<typeof ChangePlanContentSchema>;
export type ChangePlanContentInput = z.input<typeof ChangePlanContentSchema>;

export const PlanStatusSchema = z.enum([
  'draft',
  'validated',
  'awaiting_approval',
  'approved',
  'rejected',
  'executing',
  'succeeded',
  'partially_succeeded',
  'failed',
  'cancelled',
]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const ExecutionStatusSchema = z.enum([
  'queued',
  'executing',
  'succeeded',
  'partially_succeeded',
  'failed',
  'cancelled',
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const OperationStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'unknown',
  'manual',
  'cancelled',
]);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;

export const TERMINAL_EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  'succeeded',
  'partially_succeeded',
  'failed',
  'cancelled',
];

/** The exported, machine-readable plan document. `hash` covers `content` only. */
export interface ChangePlanDocument {
  planId: string;
  version: number;
  hash: string;
  status: PlanStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  validation: { valid: boolean; issues: ValidationIssue[]; validatedAt: string } | null;
  approval: {
    state: 'none' | 'pending' | 'approved' | 'rejected' | 'expired' | 'invalidated';
    decidedBy?: string;
    decidedAt?: string;
    reason?: string;
    expiresAt?: string;
  };
  execution: { id: string; status: ExecutionStatus } | null;
  content: ChangePlanContent;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  operationId?: string;
}
