import { sql, type Kysely } from 'kysely';
import type { Migration, MigrationProvider } from 'kysely/migration';

/**
 * Migrations are code, ordered by key, and applied by Kysely's Migrator with
 * a lock table. Never edit a released migration; add a new one.
 */
const m001: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('users')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('email', 'text', (c) => c.notNull().unique())
      .addColumn('display_name', 'text', (c) => c.notNull())
      .addColumn('external_subject', 'text', (c) => c.unique())
      .addColumn('disabled', 'boolean', (c) => c.notNull().defaultTo(false))
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createTable('role_assignments')
      .addColumn('id', 'serial', (c) => c.primaryKey())
      .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
      .addColumn('role', 'text', (c) =>
        c.notNull().check(sql`role in ('viewer','operator','approver','admin')`),
      )
      .addColumn('environment', 'text', (c) => c.notNull())
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addUniqueConstraint('role_assignments_unique', ['user_id', 'role', 'environment'])
      .execute();

    await db.schema
      .createTable('sessions')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
      .addColumn('csrf_token', 'text', (c) => c.notNull())
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
      .addColumn('last_seen_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createTable('connections')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('environment', 'text', (c) => c.notNull())
      .addColumn('mode', 'text', (c) => c.notNull().check(sql`mode in ('demo','live')`))
      .addColumn('base_url', 'text')
      .addColumn('kb_name', 'text', (c) => c.notNull())
      .addColumn('lang', 'text', (c) => c.notNull().defaultTo('en'))
      .addColumn('auth_method', 'text', (c) => c.notNull())
      .addColumn('secret_ciphertext', 'text')
      .addColumn('principal_hint', 'text')
      .addColumn('disabled', 'boolean', (c) => c.notNull().defaultTo(false))
      .addColumn('created_by', 'text', (c) => c.notNull())
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn('last_verification', 'jsonb')
      .addColumn('last_verified_at', 'timestamptz')
      .execute();

    await db.schema
      .createTable('environment_policies')
      .addColumn('environment', 'text', (c) => c.primaryKey())
      .addColumn('writes_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
      .addColumn('require_separation_of_duties', 'boolean', (c) => c.notNull().defaultTo(true))
      .addColumn('approval_ttl_minutes', 'integer', (c) => c.notNull().defaultTo(1440))
      .addColumn('allowed_write_tables', 'jsonb')
      .addColumn('use_record_locks', 'boolean', (c) => c.notNull().defaultTo(true))
      .addColumn('updated_by', 'text')
      .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createTable('plans')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('connection_id', 'text', (c) => c.notNull().references('connections.id'))
      .addColumn('environment', 'text', (c) => c.notNull())
      .addColumn('title', 'text', (c) => c.notNull())
      .addColumn('status', 'text', (c) => c.notNull())
      .addColumn('current_version', 'integer', (c) => c.notNull())
      .addColumn('created_by', 'text', (c) => c.notNull())
      .addColumn('submitted_by', 'text')
      .addColumn('submitted_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();
    await db.schema
      .createIndex('plans_status_idx')
      .on('plans')
      .columns(['status', 'updated_at'])
      .execute();

    await db.schema
      .createTable('plan_versions')
      .addColumn('plan_id', 'text', (c) => c.notNull().references('plans.id').onDelete('cascade'))
      .addColumn('version', 'integer', (c) => c.notNull())
      .addColumn('content', 'jsonb', (c) => c.notNull())
      .addColumn('hash', 'text', (c) => c.notNull())
      .addColumn('created_by', 'text', (c) => c.notNull())
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn('validation', 'jsonb')
      .addColumn('validated_at', 'timestamptz')
      .addPrimaryKeyConstraint('plan_versions_pk', ['plan_id', 'version'])
      .execute();

    await db.schema
      .createTable('approvals')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('plan_id', 'text', (c) => c.notNull().references('plans.id').onDelete('cascade'))
      .addColumn('plan_version', 'integer', (c) => c.notNull())
      .addColumn('plan_hash', 'text', (c) => c.notNull())
      .addColumn('connection_id', 'text', (c) => c.notNull())
      .addColumn('environment', 'text', (c) => c.notNull())
      .addColumn('decision', 'text', (c) =>
        c.notNull().check(sql`decision in ('approved','rejected')`),
      )
      .addColumn('reason', 'text', (c) => c.notNull())
      .addColumn('decided_by', 'text', (c) => c.notNull())
      .addColumn('decided_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn('expires_at', 'timestamptz')
      .addColumn('invalidated_at', 'timestamptz')
      .addColumn('invalidated_reason', 'text')
      .execute();
    await db.schema
      .createIndex('approvals_plan_idx')
      .on('approvals')
      .columns(['plan_id', 'plan_version'])
      .execute();

    await db.schema
      .createTable('executions')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('plan_id', 'text', (c) => c.notNull().references('plans.id'))
      .addColumn('plan_version', 'integer', (c) => c.notNull())
      .addColumn('plan_hash', 'text', (c) => c.notNull())
      .addColumn('approval_id', 'text', (c) => c.notNull().references('approvals.id'))
      .addColumn('connection_id', 'text', (c) => c.notNull())
      .addColumn('environment', 'text', (c) => c.notNull())
      .addColumn('status', 'text', (c) => c.notNull())
      .addColumn('requested_by', 'text', (c) => c.notNull())
      .addColumn('requested_via', 'text', (c) => c.notNull())
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn('started_at', 'timestamptz')
      .addColumn('finished_at', 'timestamptz')
      .addColumn('cancel_requested', 'boolean', (c) => c.notNull().defaultTo(false))
      .addColumn('cancel_requested_by', 'text')
      .addColumn('lease_owner', 'text')
      .addColumn('lease_expires_at', 'timestamptz')
      .addColumn('run_count', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('summary', 'jsonb')
      // One execution per approved plan version: duplicate-execution protection.
      .addUniqueConstraint('executions_plan_version_unique', ['plan_id', 'plan_version'])
      .execute();
    await db.schema
      .createIndex('executions_claim_idx')
      .on('executions')
      .columns(['status', 'lease_expires_at'])
      .execute();

    await db.schema
      .createTable('execution_operations')
      .addColumn('execution_id', 'text', (c) =>
        c.notNull().references('executions.id').onDelete('cascade'),
      )
      .addColumn('operation_id', 'text', (c) => c.notNull())
      .addColumn('seq', 'integer', (c) => c.notNull())
      .addColumn('kind', 'text', (c) => c.notNull())
      .addColumn('title', 'text', (c) => c.notNull())
      .addColumn('status', 'text', (c) => c.notNull())
      .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('record_id', 'text')
      .addColumn('started_at', 'timestamptz')
      .addColumn('finished_at', 'timestamptz')
      .addColumn('result', 'jsonb')
      .addColumn('error', 'jsonb')
      .addPrimaryKeyConstraint('execution_operations_pk', ['execution_id', 'operation_id'])
      .execute();

    await db.schema
      .createTable('execution_events')
      .addColumn('id', 'serial', (c) => c.primaryKey())
      .addColumn('execution_id', 'text', (c) =>
        c.notNull().references('executions.id').onDelete('cascade'),
      )
      .addColumn('at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn('level', 'text', (c) => c.notNull())
      .addColumn('operation_id', 'text')
      .addColumn('message', 'text', (c) => c.notNull())
      .addColumn('data', 'jsonb')
      .execute();
    await db.schema
      .createIndex('execution_events_exe_idx')
      .on('execution_events')
      .columns(['execution_id', 'id'])
      .execute();

    await db.schema
      .createTable('audit_events')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn('actor_id', 'text')
      .addColumn('actor_label', 'text', (c) => c.notNull())
      .addColumn('actor_type', 'text', (c) => c.notNull())
      .addColumn('via', 'text', (c) => c.notNull())
      .addColumn('action', 'text', (c) => c.notNull())
      .addColumn('environment', 'text')
      .addColumn('connection_id', 'text')
      .addColumn('target_type', 'text')
      .addColumn('target_id', 'text')
      .addColumn('result', 'text', (c) => c.notNull())
      .addColumn('correlation_id', 'text')
      .addColumn('details', 'jsonb')
      .execute();
    await db.schema.createIndex('audit_events_at_idx').on('audit_events').column('at').execute();

    await db.schema
      .createTable('demo_records')
      .addColumn('connection_id', 'text', (c) => c.notNull())
      .addColumn('table_name', 'text', (c) => c.notNull())
      .addColumn('record_id', 'text', (c) => c.notNull())
      .addColumn('data', 'jsonb', (c) => c.notNull())
      .addPrimaryKeyConstraint('demo_records_pk', ['connection_id', 'table_name', 'record_id'])
      .execute();

    await db.schema
      .createTable('demo_faults')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('connection_id', 'text', (c) => c.notNull())
      .addColumn('kind', 'text', (c) => c.notNull())
      .addColumn('table_name', 'text')
      .addColumn('operation', 'text')
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createTable('settings')
      .addColumn('key', 'text', (c) => c.primaryKey())
      .addColumn('value', 'jsonb', (c) => c.notNull())
      .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();
  },
  async down(db: Kysely<unknown>) {
    for (const t of [
      'settings',
      'demo_faults',
      'demo_records',
      'audit_events',
      'execution_events',
      'execution_operations',
      'executions',
      'approvals',
      'plan_versions',
      'plans',
      'environment_policies',
      'connections',
      'sessions',
      'role_assignments',
      'users',
    ]) {
      await db.schema.dropTable(t).ifExists().execute();
    }
  },
};

export const MIGRATIONS: Record<string, Migration> = { '001_initial': m001 };

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => MIGRATIONS,
};
