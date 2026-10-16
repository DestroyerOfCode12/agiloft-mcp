import { newId, redact, type Environment } from '@agiloft-control/shared';
import { sql } from 'kysely';
import type { Db } from '../db/index.ts';
import type { Principal } from '../principal.ts';

export interface AuditInput {
  principal?: Principal | null;
  system?: string;
  via?: 'console' | 'mcp' | 'worker' | 'system';
  action: string;
  result: 'success' | 'denied' | 'failure';
  environment?: Environment | string | null;
  connectionId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown>;
  correlationId?: string | null;
}

export interface AuditQuery {
  actor?: string;
  environment?: string;
  action?: string;
  result?: 'success' | 'denied' | 'failure';
  from?: string;
  to?: string;
  targetId?: string;
  limit?: number;
  before?: string;
}

export interface AuditEventView {
  id: string;
  at: string;
  actor: string;
  actorType: string;
  via: string;
  action: string;
  environment: string | null;
  connectionId: string | null;
  targetType: string | null;
  targetId: string | null;
  result: string;
  correlationId: string | null;
  details: Record<string, unknown> | null;
}

/**
 * Append-only audit log in the application database. Details are redacted
 * before storage. This log is NOT tamper-proof: database administrators can
 * alter it. Ship it to external write-once storage if that property is needed.
 */
export class AuditService {
  constructor(private readonly db: Db) {}

  async record(e: AuditInput): Promise<string> {
    const id = newId('aud');
    await this.db
      .insertInto('audit_events')
      .values({
        id,
        actor_id: e.principal?.userId ?? null,
        actor_label: e.principal
          ? `${e.principal.displayName} <${e.principal.email}>`
          : (e.system ?? 'system'),
        actor_type: e.principal ? 'user' : 'system',
        via: e.via ?? e.principal?.via ?? 'system',
        action: e.action,
        environment: e.environment ?? null,
        connection_id: e.connectionId ?? null,
        target_type: e.targetType ?? null,
        target_id: e.targetId ?? null,
        result: e.result,
        correlation_id: e.correlationId ?? e.principal?.correlationId ?? null,
        details: e.details ? JSON.stringify(redact(e.details)) : null,
      })
      .execute();
    return id;
  }

  async query(q: AuditQuery): Promise<AuditEventView[]> {
    let query = this.db
      .selectFrom('audit_events')
      .selectAll()
      .orderBy('at', 'desc')
      .orderBy('id', 'desc');
    if (q.actor)
      query = query.where(sql<boolean>`lower(actor_label) like ${`%${q.actor.toLowerCase()}%`}`);
    if (q.environment) query = query.where('environment', '=', q.environment);
    if (q.action) query = query.where('action', 'like', `${q.action}%`);
    if (q.result) query = query.where('result', '=', q.result);
    if (q.targetId) query = query.where('target_id', '=', q.targetId);
    if (q.from) query = query.where('at', '>=', new Date(q.from));
    if (q.to) query = query.where('at', '<=', new Date(q.to));
    if (q.before) query = query.where('at', '<', new Date(q.before));
    const rows = await query.limit(Math.min(Math.max(q.limit ?? 100, 1), 500)).execute();
    return rows.map((r) => ({
      id: r.id,
      at: new Date(r.at).toISOString(),
      actor: r.actor_label,
      actorType: r.actor_type,
      via: r.via,
      action: r.action,
      environment: r.environment,
      connectionId: r.connection_id,
      targetType: r.target_type,
      targetId: r.target_id,
      result: r.result,
      correlationId: r.correlation_id,
      details: (r.details as Record<string, unknown> | null) ?? null,
    }));
  }

  static toCsv(events: AuditEventView[]): string {
    const cols = [
      'at',
      'actor',
      'via',
      'action',
      'environment',
      'connectionId',
      'targetType',
      'targetId',
      'result',
      'correlationId',
      'details',
    ] as const;
    const esc = (v: unknown) => {
      let s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
      // Neutralise spreadsheet formula injection.
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    return [cols.join(','), ...events.map((e) => cols.map((c) => esc(e[c])).join(','))].join('\n');
  }

  async purgeOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const res = await this.db
      .deleteFrom('audit_events')
      .where('at', '<', cutoff)
      .executeTakeFirst();
    return Number(res.numDeletedRows ?? 0);
  }
}
