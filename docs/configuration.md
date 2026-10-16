# Configuration reference

All configuration is read from environment variables by `packages/core/src/config.ts`. It is validated at startup, so invalid values stop the process with a clear message. A template is in [`.env.example`](../.env.example).

## Runtime

| Variable          | Default                              | Notes                                                                                                   |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`        | `development`                        | `production` enables strict checks (see below)                                                          |
| `LOG_LEVEL`       | `info`                               | `fatal`…`trace`, `silent`. JSON logs on stderr; secrets redacted                                        |
| `PORT`            | `8080`                               | Console API port                                                                                        |
| `HOST`            | `127.0.0.1` (dev) / `0.0.0.0` (prod) | Bind address of the console API                                                                         |
| `PUBLIC_BASE_URL` | `http://localhost:8080`              | External URL. Used for the Origin check, cookies and the OIDC redirect. **Must be HTTPS in production** |
| `CONSOLE_DIST`    | `apps/console/dist`                  | Location of the built console                                                                           |

## Database

| Variable       | Default                 | Notes                                                                                                                                                                   |
| -------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | `pglite:./.data/pglite` | `postgres://…` for anything shared or deployed. `pglite:<dir>` is a single-process local convenience; `pglite:memory` is for tests. **PGlite is refused in production** |

Migrations run automatically at startup, protected by Kysely's migration lock. To run them explicitly: `pnpm db:migrate`.

## Secrets

| Variable                | Default | Notes                                                                                                                                                                                                                      |
| ----------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENCRYPTION_KEY`    | —       | 32 bytes, base64 (`openssl rand -base64 32`). Encrypts stored Agiloft credentials. **Required in production.** If unset in development, a temporary key is generated and stored credentials are unreadable after a restart |
| `APP_ENCRYPTION_KEY_ID` | `k1`    | Recorded in each ciphertext                                                                                                                                                                                                |

## Console authentication

| Variable                                              | Default                | Notes                                                                                                    |
| ----------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `AUTH_MODE`                                           | `dev`                  | `dev` = pick a synthetic user (refused in production); `oidc` = OpenID Connect authorization code + PKCE |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | —                      | Required for `oidc`. Register the redirect URI `<PUBLIC_BASE_URL>/api/auth/callback`                     |
| `OIDC_SCOPES`                                         | `openid email profile` | An `email` claim is required                                                                             |
| `BOOTSTRAP_ADMIN_EMAIL`                               | —                      | Granted the global admin role at startup                                                                 |
| `SESSION_TTL_HOURS`                                   | `12`                   | Session lifetime                                                                                         |

## Demo

| Variable    | Default | Notes                                                                                                                                          |
| ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEMO_MODE` | `true`  | Creates the synthetic `conn_demo` connection (environment `demo`). With `AUTH_MODE=dev`, also seeds demo users and two plans awaiting approval |

## Agiloft connections

| Variable                          | Default       | Notes                                                                                                     |
| --------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------- |
| `AGILOFT_ALLOWED_HOST_SUFFIXES`   | `agiloft.com` | Comma-separated. Cloud hosts must match and resolve to public IPs                                         |
| `AGILOFT_ONPREM_HOSTS`            | —             | Comma-separated exact hostnames or IPs of approved on-premises KBs (private IPs and custom ports allowed) |
| `AGILOFT_TIMEOUT_MS`              | `20000`       | Per-request timeout                                                                                       |
| `AGILOFT_ALLOW_INSECURE_LOOPBACK` | `false`       | Test-only; allows `http://127.0.0.1`. Refused in production                                               |

Connection credentials are entered in the console (Connections → New connection) and stored encrypted. They are never set through environment variables.

## Worker

| Variable               | Default | Notes                                                                                                           |
| ---------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| `WORKER_EMBEDDED`      | `true`  | Run the execution worker inside the API process. Set `false` and run `apps/worker` separately (PostgreSQL only) |
| `WORKER_POLL_MS`       | `1000`  | Poll interval                                                                                                   |
| `WORKER_LEASE_SECONDS` | `60`    | Lease length. An execution whose lease expires is resumed by another worker                                     |

## Audit

| Variable               | Default | Notes                                                    |
| ---------------------- | ------- | -------------------------------------------------------- |
| `AUDIT_RETENTION_DAYS` | `365`   | Older events are purged every 6 hours by the worker host |

## MCP

| Variable                   | Default                     | Notes                                                                                                                                              |
| -------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_STDIO_USER_EMAIL`     | `oli.operator@demo.local`   | Agiloft Control user that a local stdio session acts as                                                                                            |
| `MCP_STDIO_RUN_WORKER`     | `false`                     | Run a worker inside the stdio process (only useful without a separate API/worker)                                                                  |
| `MCP_HTTP_PORT`            | `8090`                      | Port of the Streamable HTTP endpoint. Started by the API when OAuth or a dev token is configured, or standalone via `apps/mcp-server/dist/http.js` |
| `MCP_RESOURCE_URL`         | `http://localhost:8090/mcp` | Public URL of the MCP endpoint. Used as the expected token audience and in protected-resource metadata                                             |
| `MCP_OAUTH_ISSUER`         | —                           | Authorization server issuer (same IdP as console OIDC, so subjects map to users)                                                                   |
| `MCP_OAUTH_JWKS_URL`       | —                           | JWKS used to verify access tokens                                                                                                                  |
| `MCP_OAUTH_AUDIENCE`       | `MCP_RESOURCE_URL`          | Expected `aud`                                                                                                                                     |
| `MCP_DEV_TOKEN`            | —                           | ≥24 characters. Static bearer token for local development; **refused in production**                                                               |
| `MCP_DEV_TOKEN_USER_EMAIL` | `oli.operator@demo.local`   | User the dev token acts as                                                                                                                         |
| `MCP_ALLOWED_ORIGIN_HOSTS` | —                           | Hostnames allowed in a browser `Origin` header (requests without Origin are allowed)                                                               |

Scopes: `agiloft:read` (required for any call), `agiloft:plan`, `agiloft:execute`, `agiloft:audit`.

## Optional model provider

| Variable            | Default           | Notes                                                                             |
| ------------------- | ----------------- | --------------------------------------------------------------------------------- |
| `MODEL_PROVIDER`    | `none`            | `anthropic` enables model interpretation of scenario text in the Scenario Builder |
| `ANTHROPIC_API_KEY` | —                 | Required when `MODEL_PROVIDER=anthropic`                                          |
| `ANTHROPIC_MODEL`   | `claude-opus-5-5` | Model used for interpretation                                                     |

The model receives only the scenario text the user typed, never record data. Its output is validated against the requirements schema and then planned by the same deterministic planner. Record operations never depend on a model.

## Production checks

With `NODE_ENV=production` the process refuses to start if any of these hold:

- `AUTH_MODE=dev`
- `MCP_DEV_TOKEN` is set
- `AGILOFT_ALLOW_INSECURE_LOOPBACK=true`
- `APP_ENCRYPTION_KEY` is missing
- `DATABASE_URL` is PGlite
- `PUBLIC_BASE_URL` is not HTTPS
