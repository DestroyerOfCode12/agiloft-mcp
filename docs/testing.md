# Testing

| Suite                    | Command                                                        | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planner unit tests       | `pnpm vitest run packages/change-planner`                      | Scenario interpretation and mapping, all 13 categories, no fabricated calendars or approvers, blocking unknowns, validation (cross-environment, writes disabled, no admin API, automated-after-manual, unknown fields, invalid choices, missing before values), dependency ordering and cycles                                                                                                                                                                                                                                                                                                       |
| Agiloft client tests     | `pnpm vitest run packages/agiloft-client`                      | **Contract tests** against a local fake returning the response shapes shown in Agiloft documentation: login in the request body, OAuth token, EWTable parsing, search parameters, Query-By-Example escaping, locks, no `NOLOCK`, write timeout = unknown outcome without retry, 5xx = ambiguous, redirects refused, credentials not echoed. Also query-builder safety, SSRF rules, redaction, and demo adapter semantics                                                                                                                                                                             |
| Core integration tests   | `pnpm vitest run packages/core`                                | Authorisation and denial auditing, MCP cannot approve, separation of duties, version and hash binding, invalidation on revision, expiry, tamper detection, policy at execution time, scope limits, successful execution with read-back, duplicate prevention, stale-record detection, partial failure without rollback, reconciliation of ambiguous creates, unknown outcomes, retry of unsent writes, crash recovery without duplicate writes, cancellation, single-claim leases, query validation, pagination, secret redaction, encryption binding, unsafe URLs, prompt-injection content as data |
| Same suite on PostgreSQL | `TEST_DATABASE_URL=postgres://… pnpm vitest run packages/core` | The suite above on real PostgreSQL 16 (row locks, `SKIP LOCKED`, transactions). Drops and recreates the `public` schema of that database for every test: use a throwaway database                                                                                                                                                                                                                                                                                                                                                                                                                    |
| MCP protocol tests       | `pnpm vitest run apps/mcp-server`                              | Real Streamable HTTP stack with the official MCP client: 401 challenge with resource metadata, wrong token, protected-resource metadata, Host validation (DNS rebinding), tool list and annotations, no approve/delete/raw tools, untrusted framing, schema validation, `approved=true` cannot bypass approval, resources                                                                                                                                                                                                                                                                            |
| Console API tests        | `pnpm vitest run apps/api`                                     | Authentication, HttpOnly cookies, CSRF, Origin checks, server-side roles, credentials encrypted and never returned (also not in audit), environment-scoped permissions, sanitised errors with correlation IDs, security headers, audit export authorisation                                                                                                                                                                                                                                                                                                                                          |
| Browser tests            | `pnpm build && pnpm test:e2e`                                  | Demo journey: capability evidence, schema discovery, filtered search, untrusted record, scenario → plan → submit, stale-data conflict, partial failure, successful approved change, approval permissions, audit log. Axe WCAG 2.2 AA checks on key pages; no horizontal overflow at 412 px; mobile navigation; skip link. Screenshots written to `docs/screenshots/`                                                                                                                                                                                                                                 |
| MCP Inspector smoke      | see [mcp-clients.md](mcp-clients.md)                           | The bundled stdio server lists all 16 tools; `--strict` reports no schema-portability warnings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Playwright uses its own Chromium. In environments with a preinstalled browser set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium`.

## Demo validation is not live validation

All of the above run against the demo adapter or a local fake that follows the documented shapes. They show that Agiloft Control behaves correctly _given_ the documented API. They do **not** show that a specific Agiloft release returns exactly those shapes. In particular, the JSON layout of `EWSearch` results is not shown in the documentation, so the parser accepts an array of records or an object containing one, and reports anything else.

## Opt-in live tests

`packages/agiloft-client/src/live.test.ts` is skipped unless configured.

**Read-only** (authenticate, list tables, describe one, search with limit 1):

```bash
AGILOFT_LIVE_BASE_URL=https://yourco.agiloft.com \
AGILOFT_LIVE_KB=YourKB \
AGILOFT_LIVE_CLIENT_ID=… AGILOFT_LIVE_CLIENT_SECRET=… \   # or AGILOFT_LIVE_LOGIN / AGILOFT_LIVE_PASSWORD
pnpm vitest run packages/agiloft-client/src/live.test.ts
```

**Sandbox writes** (one create, read-back, search and update). Only for an explicitly identified sandbox KB:

```bash
AGILOFT_LIVE_SANDBOX=true \
AGILOFT_LIVE_SANDBOX_TABLE=case \
AGILOFT_LIVE_SANDBOX_TEXT_FIELD=summary \
… pnpm vitest run packages/agiloft-client/src/live.test.ts
```

Test records are named `agiloft-control-live-test-<timestamp>` and are not deleted, because Agiloft Control does not expose deletion. Remove them manually.

**Status:** these live tests have not been run as part of this delivery because no Agiloft credentials were available.
