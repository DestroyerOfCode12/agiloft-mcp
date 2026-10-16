# Security model, threat model and limitations

## Assets

- Agiloft business data, read and written through the integration identity
- Agiloft integration credentials (login and password, or OAuth client ID and secret)
- The integrity of approvals: a plan must execute only as approved, and only once
- Audit records, which may contain record identifiers and field names
- Console sessions and MCP access tokens

## Trust boundaries

1. Browser ↔ console API (sessions, CSRF)
2. MCP client (AI assistant) ↔ MCP server: **the AI client is not trusted to approve anything**
3. Agiloft Control ↔ Agiloft KB: outbound HTTPS to approved hosts only
4. Agiloft record content ↔ AI client: **record content is untrusted data**

## Controls

| Threat                              | Control                                                                                                                                                                                                                                                                                                                                                      | Where                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| AI client approves its own change   | No approval tool. `plans:approve` is console-only even for approvers via MCP. Execution reads approval state from the database; tool arguments such as `approved=true` are not accepted (input schemas are strict)                                                                                                                                           | `principal.ts`, `control.ts#decidePlan`, `executions.ts#request` |
| Plan altered after approval         | Approval bound to version and SHA-256 content hash. Revisions create a new version and invalidate approvals. The hash is recomputed at request time and again by the worker                                                                                                                                                                                  | `plans.ts`, `executions.ts`, `engine.ts`                         |
| Approval replay or reuse            | Expiry per environment policy. Unique execution per plan version. Status transitions use conditional updates                                                                                                                                                                                                                                                 | `executions_plan_version_unique`, `plans.ts#transition`          |
| Self-approval                       | Separation of duties enforced on the server (creator, submitter and version author excluded)                                                                                                                                                                                                                                                                 | `plans.ts#decide`                                                |
| Cross-environment execution         | Approval stores connection and environment. Both are compared with the plan target and the current connection at request time and in the worker                                                                                                                                                                                                              | `executions.ts`, `engine.ts`                                     |
| Stale writes / lost updates         | Freshness check (captured before values and `date_updated`) immediately before each update, plus an `EWLock` record lock during the write                                                                                                                                                                                                                    | `engine.ts#perform`                                              |
| Duplicate writes after timeouts     | Writes are never retried after an ambiguous failure without read-based reconciliation. Creates carry a reconciliation key                                                                                                                                                                                                                                    | `engine.ts#reconcile`                                            |
| Cross-user access / IDOR            | Every read and write resolves the target's environment and checks the caller's permission for it. Lists are filtered per environment                                                                                                                                                                                                                         | `control.ts`                                                     |
| SSRF via connection URL             | HTTPS only; no credentials, query or fragment in the URL; host allow-list (cloud suffixes plus explicit on-prem hosts); DNS checked at save time **and at connect time** (rebinding); loopback, link-local and metadata ranges always blocked; private ranges allowed only for approved on-prem hosts; redirects never followed                              | `url-safety.ts`, `http.ts`                                       |
| Injection into Agiloft queries      | Structured filters only; field names validated against the schema; values quoted; values containing `'`, `&&`, `\|\|` or control characters rejected; raw SQL operations (`EWSelect`, `$searchSQL`, the `?` linked-field form) not exposed                                                                                                                   | `query.ts`, `encode.ts`                                          |
| Prompt injection via records        | MCP results wrap record data in an `untrusted-record-content` envelope with an explicit notice. Server instructions tell the client never to follow content instructions. Long values are truncated. The optional model adapter sees only scenario text typed by the user, never record data. The demo dataset contains an injection string to exercise this | `untrusted.ts`, `tools.ts`, `model-interpreter.ts`               |
| Credential exposure                 | AES-256-GCM at rest with the key supplied separately (`APP_ENCRYPTION_KEY`), associated data bound to the connection ID, never returned by the API. Only a masked hint is shown. Secret inputs are cleared in the browser after submission                                                                                                                   | `crypto.ts`, `connections.ts`                                    |
| Secrets in logs, audit or errors    | Structured redaction of credential-like keys, bearer tokens, JWTs and `$password` URL parameters. Upstream error messages truncated and redacted. Errors to clients are sanitised and carry a correlation ID                                                                                                                                                 | `redact.ts`, `logger.ts`, `server.ts`                            |
| CSRF                                | Session-bound CSRF token required on every state-changing request, plus an Origin check. Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` with the `__Host-` prefix under HTTPS                                                                                                                                                                          | `apps/api/src/auth.ts`                                           |
| Clickjacking / XSS                  | Strict CSP (`default-src 'self'`, `frame-ancestors 'none'`), helmet defaults. React escapes all record content                                                                                                                                                                                                                                               | `server.ts`                                                      |
| CORS                                | No CORS headers. The console is same-origin                                                                                                                                                                                                                                                                                                                  | `server.ts`                                                      |
| Remote MCP token misuse             | JWT verified against the issuer's JWKS for signature, issuer, audience (the MCP resource URL) and expiry. Required scope `agiloft:read` plus per-operation scope mapping. Subject must match an existing user. Tokens are never passed to Agiloft. Host and Origin validation in front of the handler (DNS rebinding)                                        | `apps/mcp-server/src/auth.ts`, `http.ts`                         |
| Brute force / abuse                 | Rate limits (300/min per IP on the API, 20/min on dev login, 120/min on MCP). Body size limits (1 MB). Request timeouts                                                                                                                                                                                                                                      | `server.ts`, `http.ts`                                           |
| Development shortcuts in production | `NODE_ENV=production` refuses `AUTH_MODE=dev`, `MCP_DEV_TOKEN`, insecure loopback, PGlite, a missing encryption key and a non-HTTPS public URL                                                                                                                                                                                                               | `config.ts`                                                      |
| Destructive operations              | No delete, action-button, async write, SQL, attachment-write or arbitrary URL capability is exposed. Writes are off by default in development, staging and production                                                                                                                                                                                        | `registry.ts`, `policies.ts`                                     |

## Roles

| Role     | Can                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| viewer   | Read connections (masked), capabilities, schema, records, plans, executions                                        |
| operator | + run read-only verification, create and validate plans, submit, execute approved plans, cancel, use demo controls |
| approver | + approve or reject plans (console only), read audit                                                               |
| admin    | Everything, incl. connections, policies, users and audit export                                                    |

Roles are granted globally (`*`) or per environment. New OIDC users get **no roles** until an administrator grants them (or `BOOTSTRAP_ADMIN_EMAIL` is used for the first administrator).

## Audit log

- Records sign-in and sign-out, connection changes, verification, record searches and reads (identifiers only), plan lifecycle events, approvals with reasons, executions and every write operation, demo controls, policy and role changes, and **denied attempts**.
- Details are redacted before storage. Retention is set by `AUDIT_RETENTION_DAYS` (default 365) and purged by the worker.
- Readable by approvers and administrators; events without an environment are visible to global auditors only. CSV export is limited to administrators, and spreadsheet formula injection is neutralised.
- **Not tamper-proof.** The log is append-only at the application level, but anyone with database write access can change it. Forward it to write-once storage (SIEM, object lock) if you need tamper evidence.

## Known security limitations

- **Shared integration identity in Agiloft.** Agiloft attributes changes to the integration account. Use a least-privilege account in a REST-enabled group, limited to the tables plans should touch, and combine this with `allowed_write_tables` in the environment policy.
- **Side effects of rules cannot be previewed.** Any write can trigger Agiloft rules configured for "Web" changes, including emails and record changes. Plans state this, but rule definitions cannot be read through any documented API.
- **Race window.** No conditional update exists in the Agiloft REST API. A client that ignores record locks can still change a record between the freshness read and the update.
- **The demo adapter's rules are a simulation** and say nothing about a real KB's behaviour.
- **Remote MCP authorisation** relies on your identity provider issuing audience-restricted JWTs. Opaque-token introspection is not implemented.
- The **MCP rate limiter** is in-memory per process. Put a gateway in front for multi-instance deployments.
- **Key rotation.** Changing `APP_ENCRYPTION_KEY` makes stored credentials unreadable. Re-enter them after rotation (no automatic re-encryption yet).

## Reporting vulnerabilities

See [SECURITY.md](../SECURITY.md).
