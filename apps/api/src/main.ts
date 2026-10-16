import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '@agiloft-control/core';
import { startMcpHttp } from '@agiloft-control/mcp-server';
import { buildServer } from './server.ts';

const here = dirname(fileURLToPath(import.meta.url));
const app = await createApp();
const server = await buildServer(app, {
  consoleDist: process.env.CONSOLE_DIST ?? resolve(here, '../../console/dist'),
});
if (app.config.WORKER_EMBEDDED) app.startWorker();
const mcp =
  app.config.MCP_OAUTH_ISSUER || app.config.MCP_DEV_TOKEN ? await startMcpHttp(app) : null;

await server.listen({
  port: app.config.PORT,
  host: process.env.HOST ?? (app.config.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
});
app.logger.info(
  {
    url: app.config.PUBLIC_BASE_URL,
    auth: app.config.AUTH_MODE,
    demo: app.config.DEMO_MODE,
    worker: app.config.WORKER_EMBEDDED,
    mcpHttp: !!mcp,
  },
  'Agiloft Control console API listening',
);

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  app.logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 30_000);
  force.unref();
  await server.close();
  await mcp?.close();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
