import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { AppError, toSafePayload } from '@agiloft-control/shared';
import type { AppContainer } from '@agiloft-control/core';
import { cookieSecret, registerAuth } from './auth.ts';
import { registerRoutes } from './routes.ts';

export async function buildServer(
  app: AppContainer,
  opts: { consoleDist?: string } = {},
): Promise<FastifyInstance> {
  const f = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024,
    trustProxy: app.config.NODE_ENV === 'production',
    genReqId: (req) => {
      const incoming = req.headers['x-correlation-id'];
      return typeof incoming === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(incoming)
        ? incoming
        : randomUUID();
    },
    requestTimeout: 60_000,
  });
  const log = app.logger.child({ component: 'api' });

  await f.register(cookie, { secret: cookieSecret(app) });
  await f.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: app.config.PUBLIC_BASE_URL.startsWith('https://') ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: app.config.PUBLIC_BASE_URL.startsWith('https://'),
  });
  // No CORS plugin: the console is served same-origin, so cross-origin browser access is refused by default.
  await f.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  f.addHook('onRequest', async (req, reply) => {
    reply.header('x-correlation-id', req.id);
  });
  f.addHook('onResponse', async (req, reply) => {
    log.info(
      {
        correlationId: req.id,
        method: req.method,
        url: req.url.split('?')[0],
        status: reply.statusCode,
        ms: Math.round(reply.elapsedTime),
      },
      'request',
    );
  });

  f.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        code: 'VALIDATION_FAILED',
        message: 'The request is not valid.',
        details: {
          issues: error.issues
            .slice(0, 20)
            .map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`),
        },
        correlationId: req.id,
      });
    }
    if (error instanceof AppError) return reply.status(error.status).send(error.toPayload(req.id));
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 429)
      return reply.status(429).send({
        code: 'RATE_LIMITED',
        message: 'Too many requests. Slow down and try again.',
        correlationId: req.id,
      });
    if (status && status >= 400 && status < 500)
      return reply.status(status).send({
        code: 'VALIDATION_FAILED',
        message: 'The request could not be processed.',
        correlationId: req.id,
      });
    log.error({ err: error, correlationId: req.id }, 'unhandled error');
    return reply.status(500).send(toSafePayload(error, req.id));
  });

  f.get('/healthz', async () => ({ status: 'ok' }));
  f.get('/readyz', async (_req, reply) => {
    const r = await app.ready();
    return reply.status(r.ok ? 200 : 503).send(r);
  });

  await registerAuth(f, app);
  registerRoutes(f, app);

  const dist = resolve(opts.consoleDist ?? resolve(process.cwd(), '../console/dist'));
  if (existsSync(resolve(dist, 'index.html'))) {
    await f.register(fastifyStatic, {
      root: dist,
      prefix: '/',
      wildcard: false,
      maxAge: '1h',
      index: false,
    });
    f.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') {
        return reply
          .status(404)
          .send({ code: 'NOT_FOUND', message: 'Not found.', correlationId: req.id });
      }
      return reply.header('cache-control', 'no-store').sendFile('index.html');
    });
  } else {
    f.setNotFoundHandler((req, reply) =>
      reply.status(404).send({
        code: 'NOT_FOUND',
        message: 'Not found. (Console build not present; run pnpm build.)',
        correlationId: req.id,
      }),
    );
  }
  return f;
}
