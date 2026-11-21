import { createApp } from '@agiloft-control/core';
import { startMcpHttp } from './http.ts';

/** Standalone remote MCP endpoint. The console API also hosts it when MCP auth is configured. */
const app = await createApp();
if (!app.config.MCP_OAUTH_ISSUER && !app.config.MCP_DEV_TOKEN) {
  app.logger.warn(
    'Neither MCP_OAUTH_ISSUER nor MCP_DEV_TOKEN is set: every request will be rejected with 401.',
  );
}
if (app.config.WORKER_EMBEDDED) app.startWorker();
const http = await startMcpHttp(app);
const shutdown = async () => {
  await http.close();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
