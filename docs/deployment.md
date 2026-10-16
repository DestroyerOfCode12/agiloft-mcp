# Deployment guidance

This project has **not** been deployed to production. This document describes the configuration it was designed for.

## Reference topology

```
            ┌────────────── TLS terminating reverse proxy / ingress ───────────────┐
 browsers ─▶│  https://control.example.com      → app:8080  (console + API)         │
 MCP hosts ▶│  https://control.example.com/mcp  → app:8090  (Streamable HTTP)       │
            └──────────────────────────────────────────────────────────────────────┘
                     app (≥1 replicas, WORKER_EMBEDDED=false)
                     worker (≥1 replicas)
                     PostgreSQL 16 (managed, encrypted at rest, PITR backups)
```

- Run the image built from the [`Dockerfile`](../Dockerfile): it runs as the non-root `node` user, with a `/healthz` health check.
- Worker: `node apps/worker/dist/main.js`. Standalone MCP endpoint (optional): `node apps/mcp-server/dist/http.js`.
- Terminate TLS in front of the app and forward `X-Forwarded-*`. `trustProxy` is enabled when `NODE_ENV=production`.
- Restrict egress from app and worker to your Agiloft hosts (defence in depth on top of the built-in allow-list).

## Required settings

```bash
NODE_ENV=production
PUBLIC_BASE_URL=https://control.example.com
DATABASE_URL=postgres://…?sslmode=require
APP_ENCRYPTION_KEY=<from secrets manager>
AUTH_MODE=oidc
OIDC_ISSUER=https://login.example.com/
OIDC_CLIENT_ID=…
OIDC_CLIENT_SECRET=<from secrets manager>
BOOTSTRAP_ADMIN_EMAIL=platform-admin@example.com
DEMO_MODE=false
WORKER_EMBEDDED=false
AGILOFT_ALLOWED_HOST_SUFFIXES=agiloft.com
# Remote MCP (optional)
MCP_RESOURCE_URL=https://control.example.com/mcp
MCP_OAUTH_ISSUER=https://login.example.com/
MCP_OAUTH_JWKS_URL=https://login.example.com/.well-known/jwks.json
```

The process refuses to start in production with development settings; see [configuration.md](configuration.md#production-checks).

## Identity provider

**Console.** Register a confidential OIDC client with redirect URI `https://control.example.com/api/auth/callback` and the scopes `openid email profile`.

**Remote MCP.** Configure your authorization server to issue JWT access tokens with:

- `aud` set to `https://control.example.com/mcp`
- a `scope` claim containing `agiloft:read` (and `agiloft:plan`, `agiloft:execute`, `agiloft:audit` as appropriate)
- the same issuer and `sub` as console sign-in, so users map to their Agiloft Control account

MCP clients discover the authorization server through `/.well-known/oauth-protected-resource/mcp`. Agiloft Control is a **resource server only**; it never issues tokens.

## Agiloft side

1. Create a dedicated integration user (or an OAuth2 client bound to a dedicated contact) in a **REST-enabled group** with the least privilege needed:
   - read on tables you want to browse;
   - create and edit only on tables plans may write.
2. Prefer OAuth 2.0 client credentials (Setup > Integration > OAuth2 Client Setup). Token expiry is 1–60 minutes.
3. Agiloft logs every change under this identity. The individual is recorded in the Agiloft Control audit log.
4. Review rules on target tables that include the "Web" modification type. They will run for API writes.

## Rollout checklist

- [ ] Staging connection first, with writes enabled only for staging.
- [ ] Run the opt-in live read-only tests, then sandbox write tests against a sandbox KB.
- [ ] Set `allowed_write_tables` for production if plans should only touch specific tables.
- [ ] Keep separation of duties on. Keep the production approval validity short (default 4 hours).
- [ ] Forward audit events to your SIEM or write-once storage.
- [ ] Test backup and restore, including `APP_ENCRYPTION_KEY` recovery.
- [ ] Only then enable writes for production (Settings → Environment policies), which requires a confirmation.
