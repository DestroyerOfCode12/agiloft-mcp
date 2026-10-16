import { z } from 'zod';
import type { Environment } from './environments.ts';

export const RoleSchema = z.enum(['viewer', 'operator', 'approver', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const PERMISSIONS = [
  'connections:read',
  'connections:manage',
  'capabilities:read',
  'capabilities:verify',
  'schema:read',
  'records:read',
  'plans:read',
  'plans:write',
  'plans:approve',
  'executions:read',
  'executions:run',
  'executions:cancel',
  'audit:read',
  'audit:export',
  'settings:read',
  'settings:manage',
  'users:manage',
  'demo:control',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = [
  'connections:read',
  'capabilities:read',
  'schema:read',
  'records:read',
  'plans:read',
  'executions:read',
  'settings:read',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  viewer: VIEWER,
  operator: [...VIEWER, 'plans:write', 'executions:run', 'executions:cancel', 'demo:control'],
  approver: [...VIEWER, 'plans:approve', 'audit:read'],
  admin: PERMISSIONS,
};

/** A role granted either globally ('*') or for one environment. */
export interface RoleAssignment {
  role: Role;
  environment: Environment | '*';
}

export function permissionsFor(assignments: readonly RoleAssignment[], environment?: Environment) {
  const result = new Set<Permission>();
  for (const a of assignments) {
    if (environment && a.environment !== '*' && a.environment !== environment) continue;
    if (!environment && a.environment !== '*') {
      // Without a specific environment, only report global permissions plus
      // read access that is meaningful across environments.
      for (const p of ROLE_PERMISSIONS[a.role]) if (p.endsWith(':read')) result.add(p);
      continue;
    }
    for (const p of ROLE_PERMISSIONS[a.role]) result.add(p);
  }
  return result;
}

export function hasPermission(
  assignments: readonly RoleAssignment[],
  permission: Permission,
  environment?: Environment,
): boolean {
  return permissionsFor(assignments, environment).has(permission);
}
