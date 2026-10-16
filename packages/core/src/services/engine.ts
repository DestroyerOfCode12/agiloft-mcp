import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import {
  AUTOMATED_KINDS,
  ChangePlanContentSchema,
  type ExecutionStatus,
  type FieldValue,
  type Operation,
  type OperationStatus,
} from '@agiloft-control/shared';
import {
  AgiloftError,
  buildQuery,
  DATE_UPDATED_FIELD,
  type AgiloftAdapter,
} from '@agiloft-control/agiloft-client';
import { planHash } from './plans.ts';
import type { Db } from '../db/index.ts';
import type { Logger } from '../logger.ts';
import type { AuditService } from './audit.ts';
import type { ConnectionService } from './connections.ts';
import type { PolicyService } from './policies.ts';

const MAX_WRITE_ATTEMPTS = 3;

type OpOutcome =
  | { status: 'succeeded'; recordId?: string; result: Record<string, unknown> }
  | {
      status: 'failed' | 'unknown';
      error: { code: string; message: string; retryable?: boolean };
      result?: Record<string, unknown>;
    };

/** Loose equality across Agiloft's representations (numbers as strings, date formats, linked values). */
export function sameValue(actual: unknown, expected: unknown): boolean {
  const empty = (v: unknown) => v === null || v === undefined || v === '';
  if (empty(actual) && empty(expected)) return true;
  if (empty(actual) || empty(expected)) return false;
  if (
    expected &&
    typeof expected === 'object' &&
    !Array.isArray(expected) &&
    'qbe' in (expected as object)
  ) {
    return (
      String(actual).toLowerCase() ===
      String((expected as { qbe: { value: string } }).qbe.value).toLowerCase()
    );
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    const a = (Array.isArray(actual) ? actual : String(actual).split(','))
      .map((x) => String(x).trim())
      .sort();
    const e = (Array.isArray(expected) ? expected : String(expected).split(','))
      .map((x) => String(x).trim())
      .sort();
    return a.length === e.length && a.every((x, i) => x === e[i]);
  }
  if (typeof actual === 'number' || typeof expected === 'number') {
    const a = Number(actual);
    const e = Number(expected);
    if (Number.isFinite(a) && Number.isFinite(e)) return Math.abs(a - e) < 1e-6;
  }
  const as = String(actual);
  const es = String(expected);
  if (as === es) return true;
  const ad = Date.parse(as);
  const ed = Date.parse(es);
  if (/\d{4}/.test(as) && /\d{4}/.test(es) && Number.isFinite(ad) && Number.isFinite(ed))
    return ad === ed;
  return as.trim().toLowerCase() === es.trim().toLowerCase();
}

function diff(record: Record<string, unknown>, expected: Record<string, unknown>) {
  return Object.entries(expected)
    .filter(([k, v]) => !sameValue(record[k], v))
    .map(([field, v]) => ({ field, expected: v, actual: record[field] ?? null }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface EngineDeps {
  db: Db;
  connections: ConnectionService;
  policies: PolicyService;
  audit: AuditService;
  logger: Logger;
}

/**
 * Durable executor. State lives in the database: an execution is claimed with
 * a lease (FOR UPDATE SKIP LOCKED), each operation is marked "running" before
 * its remote call, and a restarted worker reconciles in-doubt operations
 * instead of repeating them.
 */
export class ExecutionEngine {
  readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private stopping = false;
  private timer: NodeJS.Timeout | null = null;
  private active: Promise<void> | null = null;

  constructor(
    private readonly deps: EngineDeps,
    private readonly opts: { pollMs: number; leaseSeconds: number; retryBaseMs?: number },
  ) {}

  start() {
    this.stopping = false;
    const tick = async () => {
      if (this.stopping) return;
      try {
        this.active = this.runOnce().then(() => undefined);
        await this.active;
      } catch (e) {
        this.deps.logger.error({ err: e }, 'worker tick failed');
      } finally {
        this.active = null;
        if (!this.stopping) this.timer = setTimeout(tick, this.opts.pollMs);
      }
    };
    this.timer = setTimeout(tick, 50);
    this.deps.logger.info({ workerId: this.workerId }, 'execution worker started');
  }

  /** Graceful stop: finishes the current operation, releases the lease, leaves the rest for the next worker. */
  async stop() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active?.catch(() => undefined);
  }

  /** Claims and processes at most one execution. Returns true if work was done. */
  async runOnce(): Promise<boolean> {
    const claimed = await sql<{ id: string }>`
      update executions
         set lease_owner = ${this.workerId},
             lease_expires_at = now() + make_interval(secs => ${this.opts.leaseSeconds}),
             status = case when status = 'queued' then 'executing' else status end,
             started_at = coalesce(started_at, now()),
             run_count = run_count + 1
       where id = (
         select id from executions
          where status in ('queued', 'executing')
            and (lease_expires_at is null or lease_expires_at < now())
          order by created_at
          limit 1
          for update skip locked)
      returning id`.execute(this.deps.db);
    const id = claimed.rows[0]?.id;
    if (!id) return false;
    await this.process(id);
    return true;
  }

  private async heartbeat(id: string): Promise<boolean> {
    const res = await this.deps.db
      .updateTable('executions')
      .set({
        lease_expires_at: sql`now() + make_interval(secs => ${this.opts.leaseSeconds})` as never,
      })
      .where('id', '=', id)
      .where('lease_owner', '=', this.workerId)
      .executeTakeFirst();
    return Number(res.numUpdatedRows) === 1;
  }

  private async event(
    executionId: string,
    level: 'info' | 'warn' | 'error',
    message: string,
    operationId: string | null = null,
    data?: unknown,
  ) {
    await this.deps.db
      .insertInto('execution_events')
      .values({
        execution_id: executionId,
        level,
        operation_id: operationId,
        message,
        data: data === undefined ? null : JSON.stringify(data),
      })
      .execute();
  }

  private async setOp(executionId: string, opId: string, patch: Record<string, unknown>) {
    await this.deps.db
      .updateTable('execution_operations')
      .set(patch)
      .where('execution_id', '=', executionId)
      .where('operation_id', '=', opId)
      .execute();
  }

  async process(executionId: string): Promise<void> {
    const { db, logger } = this.deps;
    const exe = await db
      .selectFrom('executions')
      .selectAll()
      .where('id', '=', executionId)
      .executeTakeFirstOrThrow();
    const version = await db
      .selectFrom('plan_versions')
      .selectAll()
      .where('plan_id', '=', exe.plan_id)
      .where('version', '=', exe.plan_version)
      .executeTakeFirstOrThrow();
    const content = ChangePlanContentSchema.parse(version.content);
    const log = logger.child({ executionId, planId: exe.plan_id });

    if (exe.run_count > 1)
      await this.event(
        executionId,
        'warn',
        `Resumed by worker ${this.workerId} (run ${exe.run_count}). In-flight operations will be reconciled before anything is retried.`,
      );
    else await this.event(executionId, 'info', `Started by worker ${this.workerId}.`);

    // Integrity: the content must still be exactly what was approved.
    if (planHash(content) !== exe.plan_hash || version.hash !== exe.plan_hash) {
      await this.event(
        executionId,
        'error',
        'Plan content does not match the approved hash. Nothing was executed.',
      );
      await this.finish(executionId, exe.plan_id, 'failed', { reason: 'PLAN_CHANGED' });
      return;
    }

    let adapter: AgiloftAdapter;
    try {
      adapter = await this.deps.connections.adapter(exe.connection_id);
      const conn = await this.deps.connections.meta(exe.connection_id);
      if (conn.environment !== exe.environment)
        throw new Error('Connection environment changed since approval.');
    } catch (e) {
      await this.event(
        executionId,
        'error',
        `Cannot reach the target connection: ${(e as Error).message}`,
      );
      await this.finish(executionId, exe.plan_id, 'failed', { reason: 'CONNECTION_UNAVAILABLE' });
      return;
    }
    const policy = await this.deps.policies.get(exe.environment as never);
    const byId = new Map(content.operations.map((o) => [o.id, o]));
    const opRows = await db
      .selectFrom('execution_operations')
      .selectAll()
      .where('execution_id', '=', executionId)
      .orderBy('seq')
      .execute();
    const status = new Map<string, OperationStatus>(
      opRows.map((r) => [r.operation_id, r.status as OperationStatus]),
    );
    let halted = false;

    for (const row of opRows) {
      const op = byId.get(row.operation_id)!;
      const current = status.get(op.id)!;
      if (['succeeded', 'failed', 'unknown', 'skipped', 'manual', 'cancelled'].includes(current))
        continue;

      if (this.stopping) {
        await db
          .updateTable('executions')
          .set({ lease_owner: null, lease_expires_at: null })
          .where('id', '=', executionId)
          .execute();
        await this.event(
          executionId,
          'warn',
          'Worker shutting down; remaining operations will resume on the next worker.',
        );
        return;
      }
      const fresh = await db
        .selectFrom('executions')
        .select(['cancel_requested'])
        .where('id', '=', executionId)
        .executeTakeFirstOrThrow();
      if (fresh.cancel_requested) {
        await db
          .updateTable('execution_operations')
          .set({ status: 'cancelled' })
          .where('execution_id', '=', executionId)
          .where('status', 'in', ['pending'])
          .execute();
        await this.event(
          executionId,
          'warn',
          'Cancelled before this operation; no further operations were attempted.',
          op.id,
        );
        await this.finish(executionId, exe.plan_id, await this.computeStatus(executionId, true));
        return;
      }
      if (!(await this.heartbeat(executionId))) {
        log.warn('lease lost; stopping');
        return;
      }

      if (halted) {
        await this.setOp(executionId, op.id, {
          status: 'skipped',
          error: JSON.stringify({
            code: 'NOT_ATTEMPTED',
            message: 'Not attempted because an earlier operation did not succeed.',
          }),
        });
        status.set(op.id, 'skipped');
        continue;
      }

      if (!AUTOMATED_KINDS.includes(op.kind)) {
        await this.setOp(executionId, op.id, {
          status: 'manual',
          result: JSON.stringify({
            instructions: op.manualInstructions ?? [],
            note: 'Requires an Agiloft administrator; not performed by Agiloft Control.',
          }),
        });
        status.set(op.id, 'manual');
        await this.event(
          executionId,
          'info',
          `Manual step recorded for an administrator: ${op.title}`,
          op.id,
        );
        continue;
      }

      const blocked = op.dependsOn.find((d) => status.get(d) !== 'succeeded');
      if (blocked) {
        await this.setOp(executionId, op.id, {
          status: 'skipped',
          error: JSON.stringify({
            code: 'DEPENDENCY_NOT_MET',
            message: `Dependency "${blocked}" did not succeed.`,
          }),
        });
        status.set(op.id, 'skipped');
        continue;
      }

      const inDoubt = current === 'running';
      const outcome = await this.runOperation(
        executionId,
        exe.environment,
        op,
        adapter,
        row.attempts,
        inDoubt,
        policy.useRecordLocks,
      );
      await this.setOp(executionId, op.id, {
        status: outcome.status,
        finished_at: new Date(),
        ...(outcome.status === 'succeeded'
          ? {
              result: JSON.stringify(outcome.result),
              ...(outcome.recordId ? { record_id: outcome.recordId } : {}),
              error: null,
            }
          : {
              error: JSON.stringify(outcome.error),
              ...(outcome.result ? { result: JSON.stringify(outcome.result) } : {}),
            }),
      });
      status.set(op.id, outcome.status);
      await this.deps.audit.record({
        system: `worker ${this.workerId}`,
        via: 'worker',
        action: `execution.operation.${op.kind}`,
        result: outcome.status === 'succeeded' ? 'success' : 'failure',
        environment: exe.environment,
        connectionId: exe.connection_id,
        targetType: op.table ? `agiloft:${op.table}` : 'operation',
        targetId:
          outcome.status === 'succeeded'
            ? (outcome.recordId ?? op.recordId ?? null)
            : (op.recordId ?? null),
        details: {
          executionId,
          planId: exe.plan_id,
          operationId: op.id,
          requestedBy: exe.requested_by,
          outcome: outcome.status,
          ...(outcome.status !== 'succeeded' ? { error: outcome.error } : {}),
        },
      });
      if (outcome.status !== 'succeeded') {
        halted = true;
        await this.event(
          executionId,
          'error',
          outcome.status === 'unknown'
            ? `Outcome unknown for "${op.title}": ${outcome.error.message} Stopping; manual review required.`
            : `"${op.title}" failed: ${outcome.error.message} Stopping; later operations are not attempted.`,
          op.id,
        );
      }
    }
    await this.finish(executionId, exe.plan_id, await this.computeStatus(executionId, false));
  }

  private async computeStatus(executionId: string, cancelled: boolean): Promise<ExecutionStatus> {
    const ops = await this.deps.db
      .selectFrom('execution_operations')
      .select(['kind', 'status'])
      .where('execution_id', '=', executionId)
      .execute();
    const automated = ops.filter((o) => AUTOMATED_KINDS.includes(o.kind as never));
    const ok = automated.filter((o) => o.status === 'succeeded').length;
    const bad = automated.filter((o) => ['failed', 'unknown', 'skipped'].includes(o.status)).length;
    if (cancelled) return 'cancelled';
    if (bad === 0) return 'succeeded';
    return ok > 0 ? 'partially_succeeded' : 'failed';
  }

  private async finish(
    executionId: string,
    planId: string,
    status: ExecutionStatus,
    extra: Record<string, unknown> = {},
  ) {
    const ops = await this.deps.db
      .selectFrom('execution_operations')
      .select(['status'])
      .where('execution_id', '=', executionId)
      .execute();
    const count = (s: string) => ops.filter((o) => o.status === s).length;
    const summary = {
      succeeded: count('succeeded'),
      failed: count('failed'),
      unknown: count('unknown'),
      skipped: count('skipped'),
      manual: count('manual'),
      cancelled: count('cancelled'),
      ...extra,
      guidance:
        status === 'succeeded'
          ? count('manual') > 0
            ? 'Automated operations succeeded. Manual administrator steps remain; see the plan.'
            : 'All operations succeeded.'
          : status === 'partially_succeeded'
            ? 'Some operations were applied and others were not. Nothing was rolled back automatically. Review each operation; use the plan’s compensating actions or prepare a follow-up plan.'
            : status === 'cancelled'
              ? 'Cancelled. Operations marked succeeded were applied before cancellation and remain in Agiloft.'
              : 'No automated operation was applied, except any marked unknown, which must be checked in Agiloft.',
    };
    await this.deps.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('executions')
        .set({
          status,
          finished_at: new Date(),
          lease_owner: null,
          lease_expires_at: null,
          summary: JSON.stringify(summary),
        })
        .where('id', '=', executionId)
        .execute();
      await trx
        .updateTable('plans')
        .set({ status, updated_at: new Date() })
        .where('id', '=', planId)
        .execute();
      await trx
        .insertInto('execution_events')
        .values({
          execution_id: executionId,
          level: status === 'succeeded' ? 'info' : 'warn',
          operation_id: null,
          message: `Finished: ${status.replace('_', ' ')}.`,
          data: JSON.stringify(summary),
        })
        .execute();
    });
    await this.deps.audit.record({
      system: `worker ${this.workerId}`,
      via: 'worker',
      action: 'execution.finished',
      result: status === 'succeeded' ? 'success' : 'failure',
      targetType: 'execution',
      targetId: executionId,
      details: { planId, status, summary },
    });
  }

  private async runOperation(
    executionId: string,
    environment: string,
    op: Operation,
    adapter: AgiloftAdapter,
    priorAttempts: number,
    inDoubt: boolean,
    useLocks: boolean,
  ): Promise<OpOutcome> {
    void environment;
    // An operation found "running" was interrupted (crash/restart) mid-call.
    if (inDoubt) {
      await this.event(
        executionId,
        'warn',
        'Operation was in flight when the previous worker stopped; reconciling before any retry.',
        op.id,
      );
      const rec = await this.reconcile(op, adapter);
      if (rec.decision === 'applied')
        return {
          status: 'succeeded',
          recordId: rec.recordId,
          result: { reconciled: true, note: rec.note },
        };
      if (rec.decision === 'unknown')
        return { status: 'unknown', error: { code: 'AMBIGUOUS_OUTCOME', message: rec.note } };
      await this.event(executionId, 'info', `Reconciliation: ${rec.note} Safe to retry.`, op.id);
    }

    let attempts = priorAttempts;
    for (;;) {
      attempts += 1;
      // Persist intent before the remote call, so a crash leaves a visible in-doubt marker.
      await this.setOp(executionId, op.id, { status: 'running', attempts, started_at: new Date() });
      try {
        return await this.perform(executionId, op, adapter, useLocks);
      } catch (e) {
        if (!(e instanceof AgiloftError)) {
          return {
            status: 'failed',
            error: { code: 'INTERNAL', message: 'Unexpected error while executing the operation.' },
          };
        }
        if (e.writeOutcome === 'unknown') {
          await this.event(
            executionId,
            'warn',
            `Ambiguous failure (${e.kind}); checking whether the change was applied before doing anything else.`,
            op.id,
          );
          const rec = await this.reconcile(op, adapter);
          if (rec.decision === 'applied')
            return {
              status: 'succeeded',
              recordId: rec.recordId,
              result: { reconciled: true, note: rec.note },
            };
          if (rec.decision === 'unknown' || attempts >= MAX_WRITE_ATTEMPTS) {
            return { status: 'unknown', error: { code: 'AMBIGUOUS_OUTCOME', message: rec.note } };
          }
          await this.event(executionId, 'info', `Reconciliation: ${rec.note} Retrying.`, op.id);
        } else if (e.writeOutcome === 'not_sent' && attempts < MAX_WRITE_ATTEMPTS) {
          const delay = e.retryAfterMs ?? (this.opts.retryBaseMs ?? 500) * 2 ** (attempts - 1);
          await this.event(
            executionId,
            'warn',
            `Transient failure before the request reached Agiloft (${e.kind}); retrying in ${delay} ms.`,
            op.id,
          );
          await sleep(delay);
        } else {
          return {
            status: 'failed',
            error: { code: `AGILOFT_${e.kind.toUpperCase()}`, message: e.message },
          };
        }
      }
    }
  }

  private async perform(
    executionId: string,
    op: Operation,
    adapter: AgiloftAdapter,
    useLocks: boolean,
  ): Promise<OpOutcome> {
    const table = op.table!;
    if (op.kind === 'verify.read') {
      const rec = await adapter.read(table, op.recordId!);
      const mismatches = op.fields ? diff(rec.fields, op.fields as Record<string, unknown>) : [];
      return mismatches.length
        ? {
            status: 'failed',
            error: {
              code: 'VERIFY_MISMATCH',
              message: `Record differs from expectation in ${mismatches.map((m) => m.field).join(', ')}.`,
            },
            result: { mismatches },
          }
        : { status: 'succeeded', recordId: rec.id, result: { verified: true } };
    }
    if (op.kind === 'record.create') {
      const { id } = await adapter.create(table, op.fields as Record<string, FieldValue>);
      const back = await adapter.read(table, id).catch(() => null);
      const mismatches = back ? diff(back.fields, op.fields as Record<string, unknown>) : [];
      await this.event(executionId, 'info', `Created ${table} #${id}.`, op.id);
      return {
        status: 'succeeded',
        recordId: id,
        result: {
          recordId: id,
          readBack: back ? 'ok' : 'unavailable',
          ...(mismatches.length
            ? {
                readBackDifferences: mismatches,
                note: 'Values differ after save; a rule may have changed them.',
              }
            : {}),
        },
      };
    }
    // record.update: freshness check, advisory lock, write, read-back.
    const id = op.recordId!;
    const current = await adapter.read(table, id);
    const stale = diff(current.fields, op.before ?? {});
    const expectedUpdated = op.expected?.dateUpdated;
    const dateChanged =
      expectedUpdated != null && !sameValue(current.fields[DATE_UPDATED_FIELD], expectedUpdated);
    if (stale.length || dateChanged) {
      return {
        status: 'failed',
        error: {
          code: 'STALE_RECORD',
          message: `${table} #${id} changed after the plan was prepared${stale.length ? ` (${stale.map((s) => s.field).join(', ')})` : ' (date_updated differs)'}. Nothing was written. Prepare a new plan from the current record.`,
        },
        result: {
          stale,
          observedDateUpdated: current.fields[DATE_UPDATED_FIELD] ?? null,
          expectedDateUpdated: expectedUpdated ?? null,
        },
      };
    }
    let locked = false;
    if (useLocks) {
      const ls = await adapter.lockStatus(table, id);
      if (ls.status === 'LOCKED' && ls.lockedBy && ls.lockedBy !== 'integration') {
        return {
          status: 'failed',
          error: {
            code: 'RECORD_LOCKED',
            message: `${table} #${id} is locked by ${ls.lockedBy}. Nothing was written.`,
          },
        };
      }
      await adapter.lock(table, id);
      locked = true;
    }
    try {
      const after = await adapter.update(table, id, op.fields as Record<string, FieldValue>);
      const mismatches = diff(after.fields, op.fields as Record<string, unknown>);
      await this.event(executionId, 'info', `Updated ${table} #${id}.`, op.id);
      return {
        status: 'succeeded',
        recordId: id,
        result: {
          recordId: id,
          ...(mismatches.length
            ? {
                readBackDifferences: mismatches,
                note: 'Values differ after save; a rule may have changed them.',
              }
            : {}),
        },
      };
    } finally {
      if (locked) await adapter.unlock(table, id).catch(() => undefined);
    }
  }

  /** Decides whether an interrupted or ambiguous write was applied, using only reads. */
  private async reconcile(
    op: Operation,
    adapter: AgiloftAdapter,
  ): Promise<{ decision: 'applied' | 'not_applied' | 'unknown'; recordId?: string; note: string }> {
    try {
      if (op.kind === 'verify.read')
        return { decision: 'not_applied', note: 'Read-only operation.' };
      if (op.kind === 'record.create') {
        if (!op.reconcileBy) {
          return {
            decision: 'unknown',
            note: `No unique reconciliation field; check ${op.table} in Agiloft for a record matching this operation before retrying.`,
          };
        }
        const schema = await adapter.describeTable(op.table!);
        const q = buildQuery(
          [{ field: op.reconcileBy.field, op: 'eq', value: op.reconcileBy.value }],
          'and',
          schema,
        );
        const res = await adapter.search({
          table: op.table!,
          query: q,
          fields: ['id', op.reconcileBy.field],
          page: 0,
          limit: 2,
        });
        if (res.records.length === 1)
          return {
            decision: 'applied',
            recordId: res.records[0]!.id,
            note: `Found ${op.table} #${res.records[0]!.id} with ${op.reconcileBy.field} = "${op.reconcileBy.value}"; the create had been applied.`,
          };
        if (res.records.length === 0)
          return {
            decision: 'not_applied',
            note: `No ${op.table} record with ${op.reconcileBy.field} = "${op.reconcileBy.value}" exists.`,
          };
        return {
          decision: 'unknown',
          note: `Several records match ${op.reconcileBy.field} = "${op.reconcileBy.value}"; manual review required.`,
        };
      }
      const rec = await adapter.read(op.table!, op.recordId!);
      if (diff(rec.fields, op.fields as Record<string, unknown>).length === 0)
        return {
          decision: 'applied',
          recordId: rec.id,
          note: 'The record already holds the requested values.',
        };
      if (diff(rec.fields, op.before ?? {}).length === 0)
        return { decision: 'not_applied', note: 'The record still holds its previous values.' };
      return {
        decision: 'unknown',
        note: 'The record holds neither the previous nor the requested values; it may have been changed by someone else or by a rule.',
      };
    } catch (e) {
      return {
        decision: 'unknown',
        note: `Could not check the remote state: ${(e as Error).message}`,
      };
    }
  }
}
