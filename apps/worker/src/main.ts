import { createApp } from '@agiloft-control/core';

/**
 * Standalone durable execution worker. Run one or more of these against
 * PostgreSQL with WORKER_EMBEDDED=false on the API. Executions are claimed with
 * leases (FOR UPDATE SKIP LOCKED); a worker that dies mid-operation leaves an
 * in-doubt marker that the next worker reconciles before retrying anything.
 */
const app = await createApp({ seed: false });
if (app.dbHandle.kind === 'pglite') {
  app.logger.fatal(
    'The standalone worker requires PostgreSQL. With embedded PGlite, use WORKER_EMBEDDED=true on the API instead.',
  );
  process.exit(1);
}
app.startWorker();
const shutdown = async () => {
  app.logger.info('worker stopping after the current operation');
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
