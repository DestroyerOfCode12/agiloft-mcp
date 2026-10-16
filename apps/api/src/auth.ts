import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as oidc from 'openid-client';
import { z } from 'zod';
import { AppError } from '@agiloft-control/shared';
import { DEV_USERS, type AppContainer, type Principal } from '@agiloft-control/core';

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
    session?: { id: string; csrf: string };
  }
}

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

export function cookieNames(app: AppContainer) {
  const secure = app.config.PUBLIC_BASE_URL.startsWith('https://');
  return {
    secure,
    // __Host- prefix: Secure, Path=/, no Domain; prevents subdomain cookie injection.
    session: secure ? '__Host-ac_session' : 'ac_session',
    oidc: secure ? '__Host-ac_oidc' : 'ac_oidc',
  };
}

export function cookieSecret(app: AppContainer) {
  return createHmac('sha256', app.config.encryptionKey).update('cookie-signing').digest('hex');
}

/**
 * Console authentication: server-side sessions (only a random token in an
 * HttpOnly cookie; its SHA-256 is the database key), CSRF tokens bound to the
 * session, Origin checks on state-changing requests, and either OIDC or the
 * development login (which the configuration loader refuses in production).
 */
export async function registerAuth(f: FastifyInstance, app: AppContainer) {
  const names = cookieNames(app);
  const db = app.dbHandle.db;
  const ttlMs = app.config.SESSION_TTL_HOURS * 3_600_000;
  const publicOrigin = new URL(app.config.PUBLIC_BASE_URL).origin;

  async function createSession(reply: FastifyReply, userId: string) {
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    await db
      .insertInto('sessions')
      .values({
        id: sha(token),
        user_id: userId,
        csrf_token: csrf,
        expires_at: new Date(Date.now() + ttlMs),
      })
      .execute();
    reply.setCookie(names.session, token, {
      httpOnly: true,
      secure: names.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: ttlMs / 1000,
    });
    return csrf;
  }

  // Resolve the session on every request.
  f.addHook('onRequest', async (req) => {
    const token = req.cookies[names.session];
    if (!token) return;
    const row = await db
      .selectFrom('sessions')
      .selectAll()
      .where('id', '=', sha(token))
      .executeTakeFirst();
    if (!row || new Date(row.expires_at).getTime() < Date.now()) return;
    try {
      req.principal = await app.users.principalFor(row.user_id, 'console', {
        correlationId: req.id,
      });
      req.session = { id: row.id, csrf: row.csrf_token };
    } catch {
      /* disabled user: treat as anonymous */
    }
  });

  // CSRF + Origin enforcement for every state-changing API request.
  f.addHook('preHandler', async (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.url.startsWith('/api/')) return;
    const origin = req.headers.origin;
    if (origin && origin !== publicOrigin)
      throw new AppError('CSRF_FAILED', 'Cross-origin request refused.');
    if (req.url.startsWith('/api/auth/dev-login')) return; // no session yet; Origin checked above, dev only
    if (!req.session) return; // route-level auth reports 401
    const header = String(req.headers['x-csrf-token'] ?? '');
    const a = Buffer.from(header);
    const b = Buffer.from(req.session.csrf);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new AppError('CSRF_FAILED', 'Missing or invalid CSRF token. Reload the page.');
  });

  f.get('/api/auth/config', async () => ({
    mode: app.config.AUTH_MODE,
    devUsers:
      app.config.AUTH_MODE === 'dev'
        ? DEV_USERS.map((u) => ({ email: u.email, name: u.name, description: u.description }))
        : [],
  }));

  f.get('/api/session', async (req) => {
    if (!req.principal) return { authenticated: false };
    return {
      authenticated: true,
      csrfToken: req.session!.csrf,
      user: await app.control.me(req.principal),
    };
  });

  f.post('/api/auth/logout', async (req, reply) => {
    if (req.session) await db.deleteFrom('sessions').where('id', '=', req.session.id).execute();
    reply.clearCookie(names.session, { path: '/' });
    if (req.principal)
      await app.audit.record({
        principal: req.principal,
        action: 'auth.logout',
        result: 'success',
      });
    return { ok: true };
  });

  if (app.config.AUTH_MODE === 'dev') {
    f.post(
      '/api/auth/dev-login',
      { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const { email } = z.object({ email: z.string().email() }).parse(req.body);
        if (!DEV_USERS.some((u) => u.email === email))
          throw new AppError('UNAUTHENTICATED', 'Unknown development user.');
        const user = await app.users.findByEmail(email);
        if (!user) throw new AppError('UNAUTHENTICATED', 'Unknown development user.');
        const csrf = await createSession(reply, user.id);
        await app.audit.record({
          system: 'auth',
          action: 'auth.login',
          result: 'success',
          details: { method: 'dev', email },
        });
        return { ok: true, csrfToken: csrf };
      },
    );
    return;
  }

  // --------------------------------------------------------------- OIDC
  let configPromise: Promise<oidc.Configuration> | null = null;
  const getConfig = () =>
    (configPromise ??= oidc
      .discovery(
        new URL(app.config.OIDC_ISSUER!),
        app.config.OIDC_CLIENT_ID!,
        app.config.OIDC_CLIENT_SECRET,
      )
      .catch((e) => {
        configPromise = null;
        throw e;
      }));
  const redirectUri = new URL('/api/auth/callback', app.config.PUBLIC_BASE_URL).toString();

  f.get('/api/auth/login', async (_req, reply) => {
    const config = await getConfig();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: app.config.OIDC_SCOPES,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    reply.setCookie(names.oidc, JSON.stringify({ verifier, state, nonce }), {
      httpOnly: true,
      secure: names.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
      signed: true,
    });
    return reply.redirect(url.toString());
  });

  f.get('/api/auth/callback', async (req: FastifyRequest, reply) => {
    const raw = req.cookies[names.oidc];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    reply.clearCookie(names.oidc, { path: '/' });
    if (!unsigned?.valid || !unsigned.value)
      throw new AppError('UNAUTHENTICATED', 'Sign-in session expired. Try again.');
    const { verifier, state, nonce } = JSON.parse(unsigned.value) as {
      verifier: string;
      state: string;
      nonce: string;
    };
    const config = await getConfig();
    const current = new URL(req.url, app.config.PUBLIC_BASE_URL);
    let tokens;
    try {
      tokens = await oidc.authorizationCodeGrant(config, current, {
        pkceCodeVerifier: verifier,
        expectedState: state,
        expectedNonce: nonce,
        idTokenExpected: true,
      });
    } catch {
      await app.audit.record({
        system: 'auth',
        action: 'auth.login',
        result: 'failure',
        details: { method: 'oidc' },
      });
      throw new AppError('UNAUTHENTICATED', 'Sign-in failed.');
    }
    const claims = tokens.claims();
    if (!claims?.sub || typeof claims.email !== 'string')
      throw new AppError(
        'UNAUTHENTICATED',
        'The identity provider did not return an email address.',
      );
    if (claims.email_verified === false)
      throw new AppError('UNAUTHENTICATED', 'The email address is not verified.');
    const user = await app.users.ensureUser({
      email: claims.email,
      displayName: String(claims.name ?? claims.email),
      externalSubject: `${app.config.OIDC_ISSUER}|${claims.sub}`,
    });
    if (user.disabled) throw new AppError('FORBIDDEN', 'This account is disabled.');
    await createSession(reply, user.id);
    await app.audit.record({
      system: 'auth',
      action: 'auth.login',
      result: 'success',
      details: { method: 'oidc', email: claims.email },
    });
    return reply.redirect('/');
  });
}

export function requirePrincipal(req: FastifyRequest): Principal {
  if (!req.principal) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
  return req.principal;
}
