import type { AppConfig } from './config.ts';
import { loadConfig } from './config.ts';
import { createLogger, type Logger } from './logger.ts';
import { migrateToLatest, openDatabase, type DbHandle } from './db/index.ts';
import { SecretBox } from './crypto.ts';
import { AuditService } from './services/audit.ts';
import { UserService } from './services/users.ts';
import { PolicyService } from './services/policies.ts';
import { ConnectionService } from './services/connections.ts';
import { RecordService } from './services/records.ts';
import { PlanService } from './services/plans.ts';
import { ExecutionService } from './services/executions.ts';
import { ExecutionEngine } from './services/engine.ts';
import { AnthropicInterpreter } from './services/model-interpreter.ts';
import { AgiloftControl } from './control.ts';
import { seed } from './seed.ts';

export interface AppContainer {
  config: AppConfig;
  logger: Logger;
  dbHandle: DbHandle;
  control: AgiloftControl;
  users: UserService;
  audit: AuditService;
  connections: ConnectionService;
  engine: ExecutionEngine;
  /** Starts the embedded worker when WORKER_EMBEDDED=true. */
  startWorker(): void;
  ready(): Promise<{ ok: boolean; checks: Record<string, string> }>;
  close(): Promise<void>;
}

export async function createApp(
  opts: { config?: AppConfig; logger?: Logger; seed?: boolean } = {},
): Promise<AppContainer> {
  const config = opts.config ?? loadConfig();
  const logger = opts.logger ?? createLogger(config.LOG_LEVEL);
  if (config.encryptionKeyEphemeral) {
    logger.warn(
      'APP_ENCRYPTION_KEY is not set: using an ephemeral key. Stored Agiloft credentials will be unreadable after restart.',
    );
  }
  const dbHandle = openDatabase(config.DATABASE_URL);
  const db = dbHandle.db;
  await migrateToLatest(db);

  const audit = new AuditService(db);
  const users = new UserService(db);
  const policies = new PolicyService(db);
  const connections = new ConnectionService(
    db,
    new SecretBox(config.encryptionKey, config.APP_ENCRYPTION_KEY_ID),
    {
      allowedHostSuffixes: config.AGILOFT_ALLOWED_HOST_SUFFIXES,
      onPremHosts: config.AGILOFT_ONPREM_HOSTS,
      allowInsecureLoopback: config.AGILOFT_ALLOW_INSECURE_LOOPBACK,
    },
    config.AGILOFT_TIMEOUT_MS,
  );
  const records = new RecordService(connections);
  const plans = new PlanService(db, connections, records, policies);
  const executions = new ExecutionService(db, plans, connections, policies);
  const interpreter =
    config.MODEL_PROVIDER === 'anthropic' && config.ANTHROPIC_API_KEY
      ? new AnthropicInterpreter(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL)
      : null;
  const control = new AgiloftControl({
    config,
    db,
    audit,
    users,
    policies,
    connections,
    records,
    plans,
    executions,
    interpreter,
  });
  const engine = new ExecutionEngine(
    { db, connections, policies, audit, logger: logger.child({ component: 'worker' }) },
    { pollMs: config.WORKER_POLL_MS, leaseSeconds: config.WORKER_LEASE_SECONDS },
  );

  if (opts.seed !== false) {
    await seed({
      config,
      users,
      policies,
      connections,
      control,
      logger,
      hasPlans: async () =>
        !!(await db.selectFrom('plans').select('id').limit(1).executeTakeFirst()),
    });
  }

  let retentionTimer: NodeJS.Timeout | null = null;
  let workerStarted = false;
  return {
    config,
    logger,
    dbHandle,
    control,
    users,
    audit,
    connections,
    engine,
    startWorker() {
      if (workerStarted) return;
      workerStarted = true;
      engine.start();
      const purge = () =>
        audit
          .purgeOlderThan(config.AUDIT_RETENTION_DAYS)
          .then((n) => n && logger.info({ purged: n }, 'audit retention purge'))
          .catch((err) => logger.error({ err }, 'audit purge failed'));
      void purge();
      retentionTimer = setInterval(purge, 6 * 60 * 60_000);
      retentionTimer.unref();
    },
    async ready() {
      const checks: Record<string, string> = {};
      try {
        await db.selectFrom('environment_policies').select('environment').limit(1).execute();
        checks.database = 'ok';
      } catch {
        checks.database = 'unavailable';
      }
      checks.worker = workerStarted
        ? 'running (embedded)'
        : config.WORKER_EMBEDDED
          ? 'not started'
          : 'external';
      return { ok: checks.database === 'ok', checks };
    },
    async close() {
      if (retentionTimer) clearInterval(retentionTimer);
      await engine.stop();
      await connections.closeAll();
      await dbHandle.close();
    },
  };
}
