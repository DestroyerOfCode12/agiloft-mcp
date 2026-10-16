import { ENVIRONMENTS, type Environment } from '@agiloft-control/shared';
import type { Db } from '../db/index.ts';

export interface EnvironmentPolicy {
  environment: Environment;
  writesEnabled: boolean;
  requireSeparationOfDuties: boolean;
  approvalTtlMinutes: number;
  allowedWriteTables: string[] | null;
  useRecordLocks: boolean;
  updatedAt: string;
}

/** Writes default to OFF for every real environment. The demo environment only ever touches synthetic data. */
export const DEFAULT_POLICIES: Record<
  Environment,
  Omit<EnvironmentPolicy, 'environment' | 'updatedAt'>
> = {
  demo: {
    writesEnabled: true,
    requireSeparationOfDuties: true,
    approvalTtlMinutes: 24 * 60,
    allowedWriteTables: null,
    useRecordLocks: true,
  },
  development: {
    writesEnabled: false,
    requireSeparationOfDuties: true,
    approvalTtlMinutes: 24 * 60,
    allowedWriteTables: null,
    useRecordLocks: true,
  },
  staging: {
    writesEnabled: false,
    requireSeparationOfDuties: true,
    approvalTtlMinutes: 24 * 60,
    allowedWriteTables: null,
    useRecordLocks: true,
  },
  production: {
    writesEnabled: false,
    requireSeparationOfDuties: true,
    approvalTtlMinutes: 4 * 60,
    allowedWriteTables: null,
    useRecordLocks: true,
  },
};

export class PolicyService {
  constructor(private readonly db: Db) {}

  async ensureDefaults() {
    for (const env of ENVIRONMENTS) {
      const d = DEFAULT_POLICIES[env];
      await this.db
        .insertInto('environment_policies')
        .values({
          environment: env,
          writes_enabled: d.writesEnabled,
          require_separation_of_duties: d.requireSeparationOfDuties,
          approval_ttl_minutes: d.approvalTtlMinutes,
          allowed_write_tables: null,
          use_record_locks: d.useRecordLocks,
        })
        .onConflict((oc) => oc.column('environment').doNothing())
        .execute();
    }
  }

  async get(environment: Environment): Promise<EnvironmentPolicy> {
    const r = await this.db
      .selectFrom('environment_policies')
      .selectAll()
      .where('environment', '=', environment)
      .executeTakeFirst();
    if (!r)
      return {
        environment,
        ...DEFAULT_POLICIES[environment],
        updatedAt: new Date(0).toISOString(),
      };
    return {
      environment,
      writesEnabled: r.writes_enabled,
      requireSeparationOfDuties: r.require_separation_of_duties,
      approvalTtlMinutes: r.approval_ttl_minutes,
      allowedWriteTables: (r.allowed_write_tables as string[] | null) ?? null,
      useRecordLocks: r.use_record_locks,
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  async list(): Promise<EnvironmentPolicy[]> {
    return Promise.all(ENVIRONMENTS.map((e) => this.get(e)));
  }

  async update(
    environment: Environment,
    patch: Partial<Omit<EnvironmentPolicy, 'environment' | 'updatedAt'>>,
    updatedBy: string,
  ) {
    await this.db
      .updateTable('environment_policies')
      .set({
        ...(patch.writesEnabled !== undefined ? { writes_enabled: patch.writesEnabled } : {}),
        ...(patch.requireSeparationOfDuties !== undefined
          ? { require_separation_of_duties: patch.requireSeparationOfDuties }
          : {}),
        ...(patch.approvalTtlMinutes !== undefined
          ? { approval_ttl_minutes: patch.approvalTtlMinutes }
          : {}),
        ...(patch.allowedWriteTables !== undefined
          ? { allowed_write_tables: JSON.stringify(patch.allowedWriteTables) }
          : {}),
        ...(patch.useRecordLocks !== undefined ? { use_record_locks: patch.useRecordLocks } : {}),
        updated_by: updatedBy,
        updated_at: new Date(),
      })
      .where('environment', '=', environment)
      .execute();
    return this.get(environment);
  }
}
