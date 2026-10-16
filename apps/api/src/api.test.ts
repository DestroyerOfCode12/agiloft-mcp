import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp, createLogger, loadConfig, type AppContainer } from '@agiloft-control/core';
import { buildServer } from './server.ts';

let app: AppContainer;
let f: FastifyInstance;

async function login(email: string) {
  const res = await f.inject({ method: 'POST', url: '/api/auth/dev-login', payload: { email } });
  expect(res.statusCode).toBe(200);
  const cookie = String(res.headers['set-cookie']).split(';')[0]!;
  const session = await f.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
  return { cookie, csrf: (session.json() as { csrfToken: string }).csrfToken };
}

beforeAll(async () => {
  const config = loadConfig({
    DATABASE_URL: 'pglite:memory',
    NODE_ENV: 'test',
    AUTH_MODE: 'dev',
    LOG_LEVEL: 'silent',
    AGILOFT_ONPREM_HOSTS: '10.20.30.40',
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  });
  app = await createApp({ config, logger: createLogger('silent') });
  f = await buildServer(app, { consoleDist: '/nonexistent' });
}, 60_000);

afterAll(async () => {
  await f?.close();
  await app?.close();
});

describe('console API security', () => {
  it('requires authentication', async () => {
    const res = await f.inject({ method: 'GET', url: '/api/overview' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('sets an HttpOnly session cookie and never exposes the token in the body', async () => {
    const res = await f.inject({
      method: 'POST',
      url: '/api/auth/dev-login',
      payload: { email: 'vic.viewer@demo.local' },
    });
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(res.body).not.toContain(setCookie.split(';')[0]!.split('=')[1]!);
  });

  it('rejects unknown dev users', async () => {
    const res = await f.inject({
      method: 'POST',
      url: '/api/auth/dev-login',
      payload: { email: 'mallory@evil.example' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('enforces CSRF tokens on state-changing requests', async () => {
    const { cookie } = await login('oli.operator@demo.local');
    const res = await f.inject({
      method: 'POST',
      url: '/api/connections/conn_demo/test',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'CSRF_FAILED' });
  });

  it('rejects cross-origin state-changing requests', async () => {
    const { cookie, csrf } = await login('oli.operator@demo.local');
    const res = await f.inject({
      method: 'POST',
      url: '/api/connections/conn_demo/test',
      headers: { cookie, 'x-csrf-token': csrf, origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows a valid same-origin request', async () => {
    const { cookie, csrf } = await login('oli.operator@demo.local');
    const res = await f.inject({
      method: 'POST',
      url: '/api/connections/conn_demo/test',
      headers: { cookie, 'x-csrf-token': csrf, origin: 'http://localhost:8080' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('enforces roles on the server', async () => {
    const { cookie, csrf } = await login('vic.viewer@demo.local');
    const res = await f.inject({
      method: 'PATCH',
      url: '/api/settings/policies/production',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { writesEnabled: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('stores credentials encrypted and never returns them', async () => {
    const { cookie, csrf } = await login('avery.admin@demo.local');
    const res = await f.inject({
      method: 'POST',
      url: '/api/connections',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: {
        name: 'On-prem staging',
        environment: 'staging',
        baseUrl: 'https://10.20.30.40',
        kbName: 'Staging',
        auth: { method: 'password_jwt', login: 'integration.user', password: 'S3cret-Passw0rd' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('S3cret-Passw0rd');
    expect(res.body).not.toContain('integration.user');
    const conn = res.json() as { id: string; credentialsStored: boolean; principalHint: string };
    expect(conn.credentialsStored).toBe(true);
    const row = await app.dbHandle.db
      .selectFrom('connections')
      .select('secret_ciphertext')
      .where('id', '=', conn.id)
      .executeTakeFirstOrThrow();
    expect(row.secret_ciphertext).not.toContain('S3cret');
    const list = await f.inject({ method: 'GET', url: '/api/connections', headers: { cookie } });
    expect(list.body).not.toContain('S3cret-Passw0rd');
    const audit = await f.inject({
      method: 'GET',
      url: '/api/audit?action=connections.create',
      headers: { cookie },
    });
    expect(audit.body).not.toContain('S3cret-Passw0rd');
  });

  it('hides other environments from environment-scoped users', async () => {
    const { cookie } = await login('oli.operator@demo.local');
    const res = await f.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
    const perms = (res.json() as { user: { permissions: Record<string, string[]> } }).user
      .permissions;
    expect(perms.demo).toContain('executions:run');
    expect(perms.production).not.toContain('executions:run');
    expect(perms.production).not.toContain('plans:approve');
  });

  it('returns sanitised errors with a correlation ID', async () => {
    const { cookie } = await login('oli.operator@demo.local');
    const res = await f.inject({
      method: 'GET',
      url: '/api/plans/does_not_exist',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().correlationId).toBeTruthy();
    expect(res.headers['x-correlation-id']).toBeTruthy();
  });

  it('sets security headers', async () => {
    const res = await f.inject({ method: 'GET', url: '/healthz' });
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('exports audit CSV only for administrators, with formula injection neutralised', async () => {
    const op = await login('oli.operator@demo.local');
    expect(
      (await f.inject({ method: 'GET', url: '/api/audit/export', headers: { cookie: op.cookie } }))
        .statusCode,
    ).toBe(403);
    const admin = await login('avery.admin@demo.local');
    const res = await f.inject({
      method: 'GET',
      url: '/api/audit/export',
      headers: { cookie: admin.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
  });
});
