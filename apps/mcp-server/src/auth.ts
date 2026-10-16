import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { OAuthError, OAuthErrorCode, type AuthInfo } from '@modelcontextprotocol/server';
import { timingSafeEqual } from 'node:crypto';
import { MCP_SCOPES, type AppContainer, type Principal } from '@agiloft-control/core';

/**
 * OAuth resource-server token verification for the remote MCP endpoint.
 *
 * - Tokens are issued by an external authorization server (MCP_OAUTH_ISSUER)
 *   and verified locally against its JWKS: signature, issuer, expiry and
 *   audience (the MCP resource URL, RFC 8707).
 * - The token's subject must belong to an existing Agiloft Control user; roles
 *   come from Agiloft Control, never from the token.
 * - The client's token is never forwarded to Agiloft. Agiloft calls use the
 *   connection's own integration credentials.
 */
export function createVerifier(app: AppContainer) {
  const c = app.config;
  const jwks = c.MCP_OAUTH_JWKS_URL ? createRemoteJWKSet(new URL(c.MCP_OAUTH_JWKS_URL)) : null;
  const audience = c.MCP_OAUTH_AUDIENCE ?? c.MCP_RESOURCE_URL;
  const devToken = c.NODE_ENV !== 'production' ? c.MCP_DEV_TOKEN : undefined;

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      if (
        devToken &&
        token.length === devToken.length &&
        timingSafeEqual(Buffer.from(token), Buffer.from(devToken))
      ) {
        const user = await app.users.findByEmail(c.MCP_DEV_TOKEN_USER_EMAIL);
        if (!user)
          throw new OAuthError(
            OAuthErrorCode.InvalidToken,
            'Development token user does not exist',
          );
        return {
          token,
          clientId: 'dev-token',
          scopes: Object.values(MCP_SCOPES),
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          resource: new URL(c.MCP_RESOURCE_URL),
          extra: { userId: user.id, dev: true },
        };
      }
      if (!jwks || !c.MCP_OAUTH_ISSUER)
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Token verification is not configured');
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, jwks, {
          issuer: c.MCP_OAUTH_ISSUER,
          audience,
          clockTolerance: 30,
        }));
      } catch {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid or expired access token');
      }
      if (!payload.sub || !payload.exp)
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Token lacks sub or exp');
      const user = await app.users.findBySubject(`${c.MCP_OAUTH_ISSUER}|${payload.sub}`);
      if (!user)
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          'Unknown user: sign in to the Agiloft Control console once so an administrator can grant roles',
        );
      const raw = (payload.scope ?? payload.scp) as string | string[] | undefined;
      const scopes = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? raw.split(' ').filter(Boolean)
          : [];
      const aud = [payload.aud ?? []]
        .flat()
        .find((a) => URL.canParse(a) && new URL(a).origin === new URL(c.MCP_RESOURCE_URL).origin);
      return {
        token,
        clientId: String(payload.azp ?? payload.client_id ?? payload.sub),
        scopes,
        expiresAt: payload.exp,
        resource: aud ? new URL(aud) : new URL(c.MCP_RESOURCE_URL),
        extra: { userId: user.id },
      };
    },
  };
}

export async function principalFromAuth(
  app: AppContainer,
  auth: AuthInfo | undefined,
): Promise<Principal> {
  const userId = auth?.extra?.userId;
  if (typeof userId !== 'string')
    throw new Error('Unauthenticated MCP request reached the server factory');
  return app.users.principalFor(userId, 'mcp', { scopes: new Set(auth!.scopes) });
}
