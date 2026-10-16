import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse,
  originValidationResponse,
  requireBearerAuth,
} from '@modelcontextprotocol/server';
import { toWebRequest } from '@modelcontextprotocol/node';
import { MCP_SCOPES, type AppContainer } from '@agiloft-control/core';
import { buildMcpServer } from './tools.ts';
import { createVerifier, principalFromAuth } from './auth.ts';

/**
 * Remote MCP endpoint (Streamable HTTP, stateless per-request instances).
 *  - OAuth 2.1 resource server: bearer tokens verified for issuer, expiry and
 *    audience; RFC 9728 protected-resource metadata published.
 *  - Host and Origin validation in front of the handler.
 *  - Per-IP rate limiting and request-size limits.
 */
export async function startMcpHttp(app: AppContainer) {
  const c = app.config;
  const resourceUrl = new URL(c.MCP_RESOURCE_URL);
  const metadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl);
  const handler = createMcpHandler(async ({ authInfo }) =>
    buildMcpServer(app.control, await principalFromAuth(app, authInfo)),
  );
  const gate = requireBearerAuth({
    verifier: createVerifier(app),
    requiredScopes: [MCP_SCOPES.read],
    resourceMetadataUrl: metadataUrl,
    expectedResource: resourceUrl,
  });
  const allowedHosts = [resourceUrl.hostname, 'localhost', '127.0.0.1'];
  const allowedOrigins = c.MCP_ALLOWED_ORIGIN_HOSTS;
  const protectedResource = {
    resource: resourceUrl.href,
    authorization_servers: c.MCP_OAUTH_ISSUER ? [c.MCP_OAUTH_ISSUER] : [],
    scopes_supported: Object.values(MCP_SCOPES),
    bearer_methods_supported: ['header'],
    resource_name: 'Agiloft Control',
  };

  const hits = new Map<string, { n: number; reset: number }>();
  const limited = (ip: string) => {
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || h.reset < now) {
      hits.set(ip, { n: 1, reset: now + 60_000 });
      return false;
    }
    h.n += 1;
    return h.n > 120;
  };

  async function send(res: ServerResponse, response: Response) {
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    if (!response.body) return void res.end();
    Readable.fromWeb(response.body as never).pipe(res);
  }

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  async function route(req: IncomingMessage, res: ServerResponse) {
    const correlationId = randomUUID();
    res.setHeader('x-correlation-id', correlationId);
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname === '/healthz') return send(res, json(200, { status: 'ok' }));
    if (url.pathname === '/readyz') {
      const r = await app.ready();
      return send(res, json(r.ok ? 200 : 503, r));
    }
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      return send(res, json(200, protectedResource, { 'access-control-allow-origin': '*' }));
    }
    if (url.pathname !== resourceUrl.pathname) return send(res, json(404, { error: 'not_found' }));
    if (limited(req.socket.remoteAddress ?? 'unknown'))
      return send(res, json(429, { error: 'rate_limited' }, { 'retry-after': '60' }));

    const request = await toWebRequest(req, undefined, { maxRequestBodySize: 1024 * 1024 });
    const hostCheck = hostHeaderValidationResponse(request, allowedHosts);
    if (hostCheck) return send(res, hostCheck);
    if (request.headers.get('origin')) {
      const originCheck = originValidationResponse(request, allowedOrigins);
      if (originCheck) return send(res, originCheck);
    }
    const auth = await gate(request);
    if (auth instanceof Response) return send(res, auth);
    return send(res, await handler.fetch(request, { authInfo: auth }));
  }

  const server = createServer((req, res) => {
    route(req, res).catch((err) => {
      app.logger.error({ err }, 'mcp http error');
      if (!res.headersSent) {
        res.statusCode = (err as { status?: number }).status === 413 ? 413 : 500;
        res.end(
          JSON.stringify({ error: res.statusCode === 413 ? 'request_too_large' : 'server_error' }),
        );
      } else res.end();
    });
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 30_000;
  await new Promise<void>((resolve) => server.listen(c.MCP_HTTP_PORT, resolve));
  app.logger.info(
    {
      port: c.MCP_HTTP_PORT,
      resource: resourceUrl.href,
      oauth: !!c.MCP_OAUTH_ISSUER,
      devToken: !!c.MCP_DEV_TOKEN,
    },
    'Agiloft Control MCP server (Streamable HTTP) listening',
  );
  return {
    server,
    async close() {
      await handler.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
