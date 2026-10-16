# Operations

## Local setup

```bash
# Node.js 22.12+ (24 LTS recommended), pnpm 10 (corepack enable)
pnpm install
pnpm build
pnpm --filter @agiloft-control/api start     # http://localhost:8080 (embedded PGlite in apps/api/.data)
```

For development with hot reload, run the API and the console dev server in two terminals:

```bash
pnpm dev            # API on :8080 (tsx watch)
pnpm dev:console    # Vite on :5173, proxies /api to :8080
```

Set `PUBLIC_BASE_URL=http://localhost:5173` while using the Vite dev server so the Origin check matches.

## Docker Compose

```bash
cp .env.example .env
# set APP_ENCRYPTION_KEY=$(openssl rand -base64 32) and POSTGRES_PASSWORD
docker compose up --build -d
docker compose logs -f app worker
```

Services:

- `postgres` (16)
- `app`: console, API and, when MCP auth is configured, the MCP HTTP endpoint on :8090
- `worker`: durable executor

Ports are bound to `127.0.0.1` only. The compose file is a **local demo profile** (development login); see [deployment.md](deployment.md) for production.

## Database migrations

Migrations are TypeScript in `packages/core/src/db/migrations.ts` and run automatically at startup. Kysely's migrator uses a lock table, so concurrent starts are safe. To run them explicitly:

```bash
DATABASE_URL=postgres://… pnpm db:migrate
```

Rules for contributors: never edit a released migration; add `00N_description` instead. Migrations must be backwards-compatible with the previous release during rolling deploys (expand, then contract).

## Backup and restore (PostgreSQL)

The database holds the following:

| Contents                     | Sensitivity                                                           |
| ---------------------------- | --------------------------------------------------------------------- |
| Plans, approvals, executions | Business-critical evidence                                            |
| Audit events                 | Potentially sensitive                                                 |
| Users, roles, sessions       | Personal data                                                         |
| Connection credentials       | Encrypted with `APP_ENCRYPTION_KEY`, which is **not** in the database |

```bash
# Backup (custom format, compressed)
pg_dump --format=custom --no-owner --file=agiloft-control-$(date -u +%Y%m%dT%H%M%SZ).dump "$DATABASE_URL"

# Restore into an empty database
createdb agiloft_control_restore
pg_restore --no-owner --dbname=postgres://…/agiloft_control_restore agiloft-control-<timestamp>.dump
```

- Back up `APP_ENCRYPTION_KEY` **separately** (for example in a secrets manager). Without it, stored Agiloft credentials cannot be decrypted, and administrators must re-enter them. Everything else stays usable.
- Stop the worker (or set `WORKER_EMBEDDED=false` and stop `apps/worker`) before restoring, so no execution is resumed against a half-restored database.
- After a restore, executions that were `executing` resume. Operations that were in flight are reconciled by reading Agiloft before any retry.
- Sessions are restored too. To force everyone to sign in again: `DELETE FROM sessions;`.
- Test restores regularly.

PGlite data (local only) is a directory. Stop the process and copy the directory.

## Health, readiness and logs

| Endpoint                                       | Meaning                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /healthz`                                 | Process is up                                                                                   |
| `GET /readyz`                                  | Database reachable; reports worker mode (`running (embedded)` / `external`). 503 when not ready |
| MCP: `GET /healthz`, `/readyz` on the MCP port | Same checks                                                                                     |

Logs:

- JSON lines on stderr (pino), with secrets redacted.
- Each HTTP request logs method, path, status, duration and `correlationId`.
- Clients receive the same `x-correlation-id` header and error payload field. Quote it in support requests.

## Retention

- Audit events older than `AUDIT_RETENTION_DAYS` are deleted every six hours by the process that runs the worker.
- Plans, versions, approvals and executions are kept indefinitely. Archive them with SQL if your policy requires it, and keep approvals together with their executions.
- Expired sessions are ignored and can be removed with `DELETE FROM sessions WHERE expires_at < now();`.

## Shutdown and restarts

- `SIGTERM`/`SIGINT`: the API stops accepting requests. The worker finishes the operation in flight, releases its lease and exits. A hard exit after 30 s guards against hangs.
- If a process dies, its execution lease (`WORKER_LEASE_SECONDS`) expires and another worker resumes. In-doubt operations are reconciled first.
- Running several workers is safe: claims use `FOR UPDATE SKIP LOCKED`, and each execution has a single lease owner.

## Timeouts, retries and rate limits

| Concern                       | Behaviour                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agiloft request timeout       | `AGILOFT_TIMEOUT_MS`                                                                                                                                                |
| Read retries                  | Up to 2 retries with exponential backoff for network errors, 429 (honours `Retry-After`) and 502–504                                                                |
| Writes                        | Retried only when the request certainly did not reach Agiloft; otherwise reconciled                                                                                 |
| Agiloft per-call delay        | Agiloft inserts a one-second delay after every REST call by default (`WSDelay`). Large plans are therefore slow by design; Agiloft recommends imports for bulk work |
| Rate limits (Agiloft Control) | 300 requests/min per IP (API), 20/min (dev login), 120/min (MCP)                                                                                                    |

## Verifying a live connection

1. In Connections, add a live connection.
2. Choose **Test connection (read-only)**. It authenticates, lists tables, describes one, runs a one-record search and stores the results per capability.
3. Write capabilities remain "not checked" until you run the opt-in sandbox tests ([testing.md](testing.md)).
4. Writes stay disabled until an administrator enables them for the environment (Settings → Environment policies).
