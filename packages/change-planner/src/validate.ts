import {
  AUTOMATED_KINDS,
  ChangePlanContentSchema,
  PLAN_SCHEMA_VERSION,
  WRITE_KINDS,
  type ChangePlanContent,
  type Environment,
  type FieldSchema,
  type Operation,
  type TableSchema,
  type ValidationIssue,
} from '@agiloft-control/shared';
import { decideCapability, type InstanceCapabilityResult } from '@agiloft-control/capabilities';
import { orderOperations } from './graph.ts';

export interface ValidationContext {
  connection: { id: string; environment: Environment };
  /** Schemas for every table referenced by the plan (missing = table not found). */
  schemas: ReadonlyMap<string, TableSchema>;
  instanceCapabilities: readonly InstanceCapabilityResult[];
  policy: { writesEnabled: boolean; allowedWriteTables: readonly string[] | null };
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  order: string[];
}

/** Capabilities an operation needs, derived from what it does (never trusted from input). */
export function requiredCapabilities(op: Operation): string[] {
  const caps = new Set<string>();
  if (op.kind === 'record.create') caps.add('records.create');
  if (op.kind === 'record.update') {
    caps.add('records.update');
    caps.add('records.read');
  }
  if (op.kind === 'verify.read') caps.add('records.read');
  if (
    op.fields &&
    Object.values(op.fields).some((v) => v !== null && typeof v === 'object' && !Array.isArray(v))
  ) {
    caps.add('records.link_by_value');
  }
  return [...caps];
}

export function validatePlan(input: unknown, ctx: ValidationContext): ValidationResult {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string, operationId?: string) =>
    issues.push({ severity: 'error', code, message, ...(operationId ? { operationId } : {}) });
  const warn = (code: string, message: string, operationId?: string) =>
    issues.push({ severity: 'warning', code, message, ...(operationId ? { operationId } : {}) });

  const parsed = ChangePlanContentSchema.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 50)) {
      err('SCHEMA', `${i.path.join('.') || '(root)'}: ${i.message}`);
    }
    return { valid: false, issues, order: [] };
  }
  const plan: ChangePlanContent = parsed.data;
  if (plan.schemaVersion !== PLAN_SCHEMA_VERSION)
    err('SCHEMA_VERSION', `Unsupported schema version ${plan.schemaVersion}.`);

  // --- target binding
  if (plan.target.connectionId !== ctx.connection.id) {
    err(
      'TARGET_MISMATCH',
      'The plan targets a different connection than the one it is being validated against.',
    );
  }
  if (plan.target.environment !== ctx.connection.environment) {
    err(
      'ENVIRONMENT_MISMATCH',
      `The plan targets "${plan.target.environment}" but the connection belongs to "${ctx.connection.environment}".`,
    );
  }

  // --- ordering
  const ordered = orderOperations(plan.operations);
  for (const e of ordered.errors) err(e.code, e.message, e.operationId);

  const byId = new Map(plan.operations.map((o) => [o.id, o]));
  const hasWrites = plan.operations.some((o) => WRITE_KINDS.includes(o.kind));

  // --- policy
  if (hasWrites && !ctx.policy.writesEnabled) {
    err(
      'WRITES_DISABLED',
      `Writes are disabled by the "${ctx.connection.environment}" environment policy. An administrator must enable them first.`,
    );
  }

  for (const u of plan.unknowns) {
    if (u.blocking) err('BLOCKING_UNKNOWN', `Unresolved question: ${u.question}`);
  }

  for (const op of plan.operations) {
    const automated = AUTOMATED_KINDS.includes(op.kind);

    // Automated work may not wait on something only a human can do.
    for (const dep of op.dependsOn) {
      const d = byId.get(dep);
      if (automated && d && !AUTOMATED_KINDS.includes(d.kind)) {
        err(
          'AUTOMATED_AFTER_MANUAL',
          `"${op.id}" is automated but depends on manual step "${dep}". Split the plan so manual configuration is done and verified first.`,
          op.id,
        );
      }
    }

    // Route consistency.
    if (op.route === 'admin_api') {
      err(
        'NO_ADMIN_API',
        'No verified Agiloft administration API exists for this change. Use the manual administrator route.',
        op.id,
      );
    }
    if (
      automated &&
      !['config_records', 'native_existing', 'external_orchestration'].includes(op.route) &&
      op.kind !== 'verify.read'
    ) {
      // record writes are record-level operations; a 'manual_admin' route on an automated op is contradictory
      if (op.route === 'manual_admin' || op.route === 'unsupported') {
        err('ROUTE_KIND_MISMATCH', `Route "${op.route}" cannot be executed automatically.`, op.id);
      }
    }
    if (!automated) {
      if (!op.manualInstructions?.length) {
        err(
          'MISSING_INSTRUCTIONS',
          'Manual and external steps must include instructions for the person who performs them.',
          op.id,
        );
      }
      if (op.kind === 'external.orchestrate') {
        warn(
          'EXTERNAL_ORCHESTRATION',
          'External orchestration needs hosting, monitoring and credentials outside Agiloft. Prefer native Agiloft automation where it can do the job.',
          op.id,
        );
      }
      continue;
    }

    // Capability gate (derived from the operation, not from its declared capabilityIds).
    for (const cap of requiredCapabilities(op)) {
      const decision = decideCapability(cap, ctx.instanceCapabilities);
      if (!decision.allowed) err('CAPABILITY_UNAVAILABLE', decision.reason, op.id);
      else if (decision.instanceStatus === 'not_checked' && WRITE_KINDS.includes(op.kind)) {
        warn(
          'CAPABILITY_NOT_CONFIRMED',
          `${decision.definition?.title ?? cap} has not been confirmed on this connection.`,
          op.id,
        );
      }
    }

    if (!op.table) {
      err('MISSING_TABLE', 'A table is required.', op.id);
      continue;
    }
    const schema = ctx.schemas.get(op.table);
    if (!schema) {
      err('UNKNOWN_TABLE', `Table "${op.table}" was not found on the connected KB.`, op.id);
      continue;
    }
    if (
      WRITE_KINDS.includes(op.kind) &&
      ctx.policy.allowedWriteTables &&
      !ctx.policy.allowedWriteTables.includes(op.table)
    ) {
      err(
        'TABLE_NOT_ALLOWED',
        `Writes to "${op.table}" are not permitted by the environment policy.`,
        op.id,
      );
    }

    if (op.kind === 'record.update' || op.kind === 'verify.read') {
      if (!op.recordId) err('MISSING_RECORD_ID', 'A record ID is required.', op.id);
    }
    if (op.kind === 'record.update') {
      if (!op.before || Object.keys(op.before).length === 0) {
        err(
          'MISSING_BEFORE_VALUES',
          'Updates must capture current values so staleness can be detected. Prepare updates with prepare_record_update.',
          op.id,
        );
      }
      if (!op.expected || op.expected.dateUpdated === undefined) {
        warn(
          'NO_DATE_UPDATED',
          'No date_updated was captured; freshness relies on comparing field values only.',
          op.id,
        );
      }
    }
    if (WRITE_KINDS.includes(op.kind)) {
      if (!op.fields || Object.keys(op.fields).length === 0) {
        err('NO_FIELDS', 'A write must set at least one field.', op.id);
      } else {
        checkFields(op, schema, err, warn);
      }
      if (op.kind === 'record.create' && !op.reconcileBy) {
        warn(
          'NO_RECONCILE_KEY',
          'No unique reconciliation field. If the response to this create is lost, the outcome must be checked manually.',
          op.id,
        );
      }
      if (
        op.kind === 'record.create' &&
        op.reconcileBy &&
        op.fields?.[op.reconcileBy.field] !== op.reconcileBy.value
      ) {
        err('RECONCILE_MISMATCH', 'reconcileBy must match a value the operation sets.', op.id);
      }
    }
    if (op.irreversible && !op.irreversibleReason) {
      warn('IRREVERSIBLE_UNEXPLAINED', 'Irreversible operations should explain why.', op.id);
    }
  }

  if (hasWrites && !plan.sideEffects.some((s) => !s.reversible)) {
    warn(
      'SIDE_EFFECTS_UNDECLARED',
      'Writes can trigger Agiloft rules; declare possible irreversible side effects.',
    );
  }

  return { valid: !issues.some((i) => i.severity === 'error'), issues, order: ordered.order };
}

function checkFields(
  op: Operation,
  schema: TableSchema,
  err: (code: string, message: string, operationId?: string) => void,
  warn: (code: string, message: string, operationId?: string) => void,
) {
  const fields = new Map(schema.fields.map((f) => [f.name, f]));
  for (const [name, value] of Object.entries(op.fields ?? {})) {
    const field = fields.get(name);
    if (!field) {
      err('UNKNOWN_FIELD', `Field "${name}" does not exist in "${schema.name}".`, op.id);
      continue;
    }
    if (field.readOnly || field.type === 'id')
      err('READ_ONLY_FIELD', `Field "${name}" is read-only.`, op.id);
    checkValueType(field, value, op.id, err);
  }
  if (op.kind === 'record.create') {
    for (const f of schema.fields) {
      if (f.readOnly || f.type === 'id') continue;
      const v = op.fields?.[f.name];
      const missing = v === undefined || v === null || v === '';
      if (f.required === true && missing)
        err('REQUIRED_FIELD_MISSING', `Required field "${f.name}" is not set.`, op.id);
    }
    if (schema.fields.some((f) => f.required === null)) {
      warn(
        'REQUIRED_UNKNOWN',
        `The KB did not state which fields of "${schema.name}" are required; Agiloft may reject the create.`,
        op.id,
      );
    }
  }
}

function checkValueType(
  field: FieldSchema,
  value: unknown,
  opId: string,
  err: (code: string, message: string, operationId?: string) => void,
) {
  if (value === null) return;
  const isQbe = typeof value === 'object' && !Array.isArray(value);
  if (isQbe && field.type !== 'link')
    err('INVALID_VALUE', `Only linked fields accept link values ("${field.name}").`, opId);
  if (Array.isArray(value) && field.type !== 'multichoice' && field.type !== 'link') {
    err('INVALID_VALUE', `"${field.name}" does not accept multiple values.`, opId);
  }
  if (
    ['integer', 'decimal', 'currency'].includes(field.type) &&
    (typeof value === 'string' ? !Number.isFinite(Number(value)) : typeof value !== 'number')
  ) {
    err('INVALID_VALUE', `"${field.name}" expects a number.`, opId);
  }
  if (
    field.type === 'choice' &&
    field.choices &&
    typeof value === 'string' &&
    !field.choices.includes(value)
  ) {
    err(
      'INVALID_CHOICE',
      `"${value}" is not a valid choice for "${field.name}" (${field.choices.join(', ')}).`,
      opId,
    );
  }
  if (
    (field.type === 'date' || field.type === 'datetime') &&
    typeof value === 'string' &&
    Number.isNaN(Date.parse(value))
  ) {
    err('INVALID_VALUE', `"${field.name}" expects an ISO date.`, opId);
  }
}
