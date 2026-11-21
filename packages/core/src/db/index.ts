import { mkdirSync } from 'node:fs';
import { Kysely, PostgresDialect } from 'kysely';
import { Migrator } from 'kysely/migration';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from './schema.ts';
import { migrationProvider } from './migrations.ts';

export type Db = Kysely<Database>;
export type { Database } from './schema.ts';

export interface DbHandle {
  db: Db;
  kind: 'postgres' | 'pglite';
  close(): Promise<void>;
}

/**
 * postgres://…   PostgreSQL (all deployments)
 * pglite:memory  in-process PGlite, ephemeral (tests)
 * pglite:<dir>   in-process PGlite persisted to a directory (single-process local use)
 */
export function openDatabase(url: string): DbHandle {
  if (url.startsWith('pglite:')) {
    const target = url.slice('pglite:'.length);
    let client: PGlite;
    if (target === 'memory' || target === '') client = new PGlite();
    else {
      mkdirSync(target, { recursive: true });
      client = new PGlite(target);
    }
    const db = new Kysely<Database>({ dialect: new PGliteDialect(client) });
    return {
      db,
      kind: 'pglite',
      close: async () => {
        await db.destroy();
        if (!client.closed) await client.close();
      },
    };
  }
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    statement_timeout: 30_000,
    idleTimeoutMillis: 30_000,
  });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  return { db, kind: 'postgres', close: () => db.destroy() };
}

export async function migrateToLatest(db: Db): Promise<string[]> {
  const migrator = new Migrator({ db, provider: migrationProvider });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error(String(error));
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
