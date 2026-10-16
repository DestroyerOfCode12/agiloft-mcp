import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createApp, type Principal } from '@agiloft-control/core';
import { buildMcpServer } from './tools.ts';

/**
 * Local stdio transport. The MCP host launches this process; it runs as the
 * Agiloft Control user named by MCP_STDIO_USER_EMAIL, whose roles still apply.
 * stdout carries protocol messages only; logs go to stderr.
 *
 * Initialisation (migrations, seeding) runs in the background so the host's
 * connection handshake is not delayed; the server factory awaits it.
 */
const ready = (async () => {
  const app = await createApp();
  const user = await app.users.findByEmail(app.config.MCP_STDIO_USER_EMAIL);
  if (!user) {
    app.logger.fatal(
      { email: app.config.MCP_STDIO_USER_EMAIL },
      'MCP_STDIO_USER_EMAIL does not match an Agiloft Control user',
    );
    process.exit(1);
  }
  const principal: Principal = await app.users.principalFor(user.id, 'mcp');
  if (process.env.MCP_STDIO_RUN_WORKER === 'true') app.startWorker();
  app.logger.info({ user: user.email }, 'Agiloft Control MCP server (stdio) ready');
  return { app, principal };
})();
ready.catch((err) => {
  process.stderr.write(`Agiloft Control failed to start: ${(err as Error).message}\n`);
  process.exit(1);
});

const handle = serveStdio(async () => {
  const { app, principal } = await ready;
  return buildMcpServer(app.control, principal);
});

const shutdown = async () => {
  await handle.close();
  const { app } = await ready;
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
