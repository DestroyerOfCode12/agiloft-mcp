import {
  AppError,
  hasPermission,
  type Environment,
  type Permission,
  type RoleAssignment,
} from '@agiloft-control/shared';

/** The authenticated caller, always resolved server-side from a session or token. */
export interface Principal {
  userId: string;
  email: string;
  displayName: string;
  roles: RoleAssignment[];
  via: 'console' | 'mcp';
  /** OAuth scopes from a remote MCP access token. Undefined for console sessions and stdio. */
  scopes?: ReadonlySet<string>;
  correlationId?: string;
}

export const MCP_SCOPES = {
  read: 'agiloft:read',
  plan: 'agiloft:plan',
  execute: 'agiloft:execute',
  audit: 'agiloft:audit',
} as const;

/**
 * Permissions that are never available through MCP, whatever the user's roles:
 * approvals, administration and demo resets require a human in the console.
 */
const CONSOLE_ONLY: ReadonlySet<Permission> = new Set<Permission>([
  'plans:approve',
  'connections:manage',
  'settings:manage',
  'users:manage',
  'audit:export',
]);

export function scopeFor(permission: Permission): string | null {
  if (CONSOLE_ONLY.has(permission)) return null;
  if (permission === 'plans:write' || permission === 'demo:control') return MCP_SCOPES.plan;
  if (permission === 'executions:run' || permission === 'executions:cancel')
    return MCP_SCOPES.execute;
  if (permission === 'audit:read') return MCP_SCOPES.audit;
  return MCP_SCOPES.read;
}

export function checkPermission(
  p: Principal,
  permission: Permission,
  environment?: Environment,
): { ok: true } | { ok: false; reason: string } {
  if (p.via === 'mcp') {
    const scope = scopeFor(permission);
    if (!scope)
      return {
        ok: false,
        reason: `"${permission}" can only be performed by a person in the Agiloft Control console.`,
      };
    if (p.scopes && !p.scopes.has(scope))
      return { ok: false, reason: `The access token lacks the "${scope}" scope.` };
  }
  if (!hasPermission(p.roles, permission, environment)) {
    return {
      ok: false,
      reason: `Your role does not grant "${permission}"${environment ? ` in the ${environment} environment` : ''}.`,
    };
  }
  return { ok: true };
}

export function forbidden(reason: string): AppError {
  return new AppError('FORBIDDEN', reason);
}
