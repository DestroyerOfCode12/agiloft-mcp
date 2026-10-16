import {
  AppError,
  newId,
  RoleSchema,
  type Environment,
  type Role,
  type RoleAssignment,
} from '@agiloft-control/shared';
import type { Db } from '../db/index.ts';
import type { Principal } from '../principal.ts';

export interface UserView {
  id: string;
  email: string;
  displayName: string;
  disabled: boolean;
  roles: RoleAssignment[];
}

export class UserService {
  constructor(private readonly db: Db) {}

  async findByEmail(email: string) {
    return this.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email.toLowerCase())
      .executeTakeFirst();
  }

  async rolesOf(userId: string): Promise<RoleAssignment[]> {
    const rows = await this.db
      .selectFrom('role_assignments')
      .select(['role', 'environment'])
      .where('user_id', '=', userId)
      .execute();
    return rows.map((r) => ({
      role: RoleSchema.parse(r.role),
      environment: r.environment as Environment | '*',
    }));
  }

  /** Creates the user on first sign-in. New users receive no roles until an administrator grants them. */
  async ensureUser(args: { email: string; displayName: string; externalSubject?: string | null }) {
    const email = args.email.toLowerCase();
    const existing = args.externalSubject
      ? await this.db
          .selectFrom('users')
          .selectAll()
          .where('external_subject', '=', args.externalSubject)
          .executeTakeFirst()
      : await this.findByEmail(email);
    if (existing) return existing;
    const byEmail = await this.findByEmail(email);
    if (byEmail) {
      if (args.externalSubject && !byEmail.external_subject) {
        await this.db
          .updateTable('users')
          .set({ external_subject: args.externalSubject })
          .where('id', '=', byEmail.id)
          .execute();
      }
      return { ...byEmail, external_subject: args.externalSubject ?? byEmail.external_subject };
    }
    const row = {
      id: newId('usr'),
      email,
      display_name: args.displayName.slice(0, 120),
      external_subject: args.externalSubject ?? null,
    };
    await this.db.insertInto('users').values(row).execute();
    return (await this.findByEmail(email))!;
  }

  async grant(userId: string, role: Role, environment: Environment | '*') {
    await this.db
      .insertInto('role_assignments')
      .values({ user_id: userId, role, environment })
      .onConflict((oc) => oc.columns(['user_id', 'role', 'environment']).doNothing())
      .execute();
  }

  async setRoles(userId: string, roles: RoleAssignment[]) {
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('role_assignments').where('user_id', '=', userId).execute();
      for (const r of roles)
        await trx
          .insertInto('role_assignments')
          .values({ user_id: userId, role: r.role, environment: r.environment })
          .execute();
    });
  }

  async principalFor(
    userId: string,
    via: Principal['via'],
    extra: Partial<Principal> = {},
  ): Promise<Principal> {
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user || user.disabled)
      throw new AppError('UNAUTHENTICATED', 'The account is unknown or disabled.');
    return {
      userId: user.id,
      email: user.email,
      displayName: user.display_name,
      roles: await this.rolesOf(user.id),
      via,
      ...extra,
    };
  }

  async list(): Promise<UserView[]> {
    const users = await this.db.selectFrom('users').selectAll().orderBy('email').execute();
    return Promise.all(
      users.map(async (u) => ({
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        disabled: u.disabled,
        roles: await this.rolesOf(u.id),
      })),
    );
  }

  async displayNames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .selectFrom('users')
      .select(['id', 'display_name'])
      .where('id', 'in', [...new Set(ids)])
      .execute();
    return new Map(rows.map((r) => [r.id, r.display_name]));
  }
}
