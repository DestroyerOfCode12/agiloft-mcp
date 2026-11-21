import { sql } from 'kysely';
import { newId } from '@agiloft-control/shared';
import type { DemoDataStore, DemoFault, DemoRow } from '@agiloft-control/agiloft-client';
import { DEMO_RECORDS } from '@agiloft-control/test-fixtures';
import type { Db } from '../db/index.ts';

/**
 * Database-backed storage for the demo adapter, so demo state is shared by the
 * API, MCP server and worker processes and survives restarts.
 */
export class DbDemoStore implements DemoDataStore {
  constructor(
    private readonly db: Db,
    private readonly connectionId: string,
  ) {}

  async seedIfEmpty(): Promise<void> {
    const existing = await this.db
      .selectFrom('demo_records')
      .select('record_id')
      .where('connection_id', '=', this.connectionId)
      .limit(1)
      .executeTakeFirst();
    if (existing) return;
    await this.reset();
  }

  async list(table: string): Promise<DemoRow[]> {
    const rows = await this.db
      .selectFrom('demo_records')
      .select('data')
      .where('connection_id', '=', this.connectionId)
      .where('table_name', '=', table)
      .execute();
    return rows.map((r) => r.data as DemoRow);
  }

  async get(table: string, id: string): Promise<DemoRow | null> {
    const r = await this.db
      .selectFrom('demo_records')
      .select('data')
      .where('connection_id', '=', this.connectionId)
      .where('table_name', '=', table)
      .where('record_id', '=', id)
      .executeTakeFirst();
    return (r?.data as DemoRow | undefined) ?? null;
  }

  async insert(table: string, row: DemoRow): Promise<string> {
    return this.db.transaction().execute(async (trx) => {
      // Serialise id allocation per table.
      await sql`select pg_advisory_xact_lock(hashtext(${`${this.connectionId}:${table}`}))`.execute(
        trx,
      );
      const max = await trx
        .selectFrom('demo_records')
        .select(sql<number>`coalesce(max(record_id::bigint), 0)`.as('m'))
        .where('connection_id', '=', this.connectionId)
        .where('table_name', '=', table)
        .executeTakeFirst();
      const id = String(Math.max(Number(max?.m ?? 0) + 1, 900));
      await trx
        .insertInto('demo_records')
        .values({
          connection_id: this.connectionId,
          table_name: table,
          record_id: id,
          data: JSON.stringify({ ...row, id }),
        })
        .execute();
      return id;
    });
  }

  async update(table: string, id: string, patch: DemoRow): Promise<DemoRow> {
    const current = await this.get(table, id);
    if (!current) throw new Error('not found');
    const next = { ...current, ...patch, id };
    await this.db
      .updateTable('demo_records')
      .set({ data: JSON.stringify(next) })
      .where('connection_id', '=', this.connectionId)
      .where('table_name', '=', table)
      .where('record_id', '=', id)
      .execute();
    return next;
  }

  async listFaults(): Promise<DemoFault[]> {
    const rows = await this.db
      .selectFrom('demo_faults')
      .selectAll()
      .where('connection_id', '=', this.connectionId)
      .orderBy('created_at')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as DemoFault['kind'],
      table: r.table_name,
      operation: r.operation as DemoFault['operation'],
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  async addFault(f: Omit<DemoFault, 'id' | 'createdAt'>): Promise<DemoFault> {
    const id = newId('op').replace('op_', 'fault_');
    await this.db
      .insertInto('demo_faults')
      .values({
        id,
        connection_id: this.connectionId,
        kind: f.kind,
        table_name: f.table,
        operation: f.operation,
      })
      .execute();
    return { ...f, id, createdAt: new Date().toISOString() };
  }

  async takeFault(table: string, operation: 'create' | 'update'): Promise<DemoFault | null> {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('demo_faults')
        .selectAll()
        .where('connection_id', '=', this.connectionId)
        .where((eb) => eb.or([eb('table_name', 'is', null), eb('table_name', '=', table)]))
        .where((eb) => eb.or([eb('operation', 'is', null), eb('operation', '=', operation)]))
        .orderBy('created_at')
        .limit(1)
        .forUpdate()
        .executeTakeFirst();
      if (!row) return null;
      await trx.deleteFrom('demo_faults').where('id', '=', row.id).execute();
      return {
        id: row.id,
        kind: row.kind as DemoFault['kind'],
        table: row.table_name,
        operation: row.operation as DemoFault['operation'],
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }

  async clearFaults(): Promise<void> {
    await this.db
      .deleteFrom('demo_faults')
      .where('connection_id', '=', this.connectionId)
      .execute();
  }

  async reset(): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('demo_records').where('connection_id', '=', this.connectionId).execute();
      await trx.deleteFrom('demo_faults').where('connection_id', '=', this.connectionId).execute();
      for (const [table, rows] of Object.entries(DEMO_RECORDS)) {
        for (const row of rows) {
          await trx
            .insertInto('demo_records')
            .values({
              connection_id: this.connectionId,
              table_name: table,
              record_id: String(row.id),
              data: JSON.stringify(row),
            })
            .execute();
        }
      }
    });
  }
}
