import { LAPTOP_SCENARIO_TEXT } from '@agiloft-control/test-fixtures';
import type { Environment, Role } from '@agiloft-control/shared';
import type { AgiloftControl } from './control.ts';
import type { AppConfig } from './config.ts';
import type { Logger } from './logger.ts';
import type { ConnectionService } from './services/connections.ts';
import type { PolicyService } from './services/policies.ts';
import type { UserService } from './services/users.ts';

/** Development-only accounts. Created only when AUTH_MODE=dev (which production refuses). */
export const DEV_USERS: {
  email: string;
  name: string;
  roles: { role: Role; environment: Environment | '*' }[];
  description: string;
}[] = [
  {
    email: 'avery.admin@demo.local',
    name: 'Avery Admin',
    roles: [{ role: 'admin', environment: '*' }],
    description: 'Administrator: connections, policies, users',
  },
  {
    email: 'oli.operator@demo.local',
    name: 'Oli Operator',
    roles: [
      { role: 'viewer', environment: '*' },
      { role: 'operator', environment: 'demo' },
      { role: 'operator', environment: 'development' },
    ],
    description: 'Operator: prepares and executes plans (demo and development)',
  },
  {
    email: 'ana.approver@demo.local',
    name: 'Ana Approver',
    roles: [{ role: 'approver', environment: '*' }],
    description: 'Approver: reviews and approves plans',
  },
  {
    email: 'vic.viewer@demo.local',
    name: 'Vic Viewer',
    roles: [{ role: 'viewer', environment: '*' }],
    description: 'Viewer: read-only',
  },
];

export async function seed(deps: {
  config: AppConfig;
  users: UserService;
  policies: PolicyService;
  connections: ConnectionService;
  control: AgiloftControl;
  logger: Logger;
  hasPlans: () => Promise<boolean>;
}) {
  const { config, users, policies, connections, control, logger } = deps;
  await policies.ensureDefaults();

  if (config.BOOTSTRAP_ADMIN_EMAIL) {
    const u = await users.ensureUser({
      email: config.BOOTSTRAP_ADMIN_EMAIL,
      displayName: config.BOOTSTRAP_ADMIN_EMAIL,
    });
    await users.grant(u.id, 'admin', '*');
  }
  if (config.AUTH_MODE === 'dev') {
    for (const d of DEV_USERS) {
      const u = await users.ensureUser({ email: d.email, displayName: d.name });
      for (const r of d.roles) await users.grant(u.id, r.role, r.environment);
    }
  }
  if (!config.DEMO_MODE) return;

  const connId = await connections.ensureDemoConnection('system');
  const conn = await connections.get(connId);
  if (!conn.lastVerification) await connections.verify(connId);

  if (config.AUTH_MODE !== 'dev' || (await deps.hasPlans())) return;
  const operator = await users.findByEmail('oli.operator@demo.local');
  if (!operator) return;
  const p = await users.principalFor(operator.id, 'console');
  try {
    const scenario = await control.createPlanFromScenario(p, connId, {
      text: LAPTOP_SCENARIO_TEXT,
    });
    if (scenario.status === 'validated') await control.submitPlan(p, scenario.planId);
    const update = await control.prepareRecordUpdate(p, connId, {
      table: 'laptop_requests',
      recordId: '304',
      fields: { status: 'Pending Manager Approval' },
      title: 'Route LR-1004 to manager approval',
      reason: 'Battery replacement request was submitted without routing.',
    });
    if (update.status === 'validated') await control.submitPlan(p, update.planId);
    logger.info('seeded demo plans');
  } catch (e) {
    logger.warn({ err: e }, 'demo plan seeding failed');
  }
}
