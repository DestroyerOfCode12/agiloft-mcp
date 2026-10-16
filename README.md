# Agiloft Control

Agiloft Control is an **MCP server** and **web administration console** that give authorised AI assistants and administrators governed access to an Agiloft knowledge base (KB). It lets them:

- discover tables, fields and relationships;
- search and read records;
- turn a plain-language business scenario into a reviewable, versioned **change plan**;
- apply the parts that Agiloft's documented APIs actually support, after a human approves the exact plan.

It does **not** pretend that record CRUD is platform administration. Agiloft documents no external API for creating or changing tables, fields, rules, layouts, permissions or workflows. Plans therefore list those steps as **manual administrator steps** with instructions, and nothing claims they were applied.

![Overview](docs/screenshots/overview.png)

| Change plan review                               | Execution with partial failure                             |
| ------------------------------------------------ | ---------------------------------------------------------- |
| ![Change plan](docs/screenshots/change-plan.png) | ![Partial failure](docs/screenshots/execution-partial.png) |

## What is in the box

| Component           | Path                      | Purpose                                                                                                     |
| ------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| MCP server          | `apps/mcp-server`         | 16 tools and 4 resources over **stdio** (local) and **Streamable HTTP** (remote, OAuth 2.1 resource server) |
| Console API         | `apps/api`                | Fastify API for the console: sessions, CSRF protection, OIDC or dev login                                   |
| Console             | `apps/console`            | React administration console (11 pages)                                                                     |
| Worker              | `apps/worker`             | Durable execution worker (can also run embedded in the API)                                                 |
| Core services       | `packages/core`           | Policy, approvals, execution engine, audit, persistence; shared by MCP and console                          |
| Agiloft client      | `packages/agiloft-client` | Live REST adapter, SSRF-safe HTTP, query builder, **demo adapter**                                          |
| Capability registry | `packages/capabilities`   | What Agiloft supports, with official documentation evidence                                                 |
| Change planner      | `packages/change-planner` | Deterministic scenario analysis, plan validation and dependency ordering                                    |
| Shared              | `packages/shared`         | Schemas (incl. the versioned change-plan schema), errors, redaction                                         |

## Quick start (demo, no Agiloft credentials needed)

Requirements: Node.js 22.12+ (24 LTS recommended) and pnpm 10.

```bash
pnpm install
pnpm demo            # builds everything and starts http://localhost:8080
```

Open <http://localhost:8080>. In the development login, choose one of four synthetic users: Avery Admin, Oli Operator, Ana Approver or Vic Viewer. The demo uses an embedded PGlite database in `.data/` and a clearly labelled **demo adapter** with synthetic data. **It never contacts a real Agiloft instance.**

With Docker (PostgreSQL, API and a separate worker):

```bash
cp .env.example .env    # optional: set APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
docker compose up --build
```

To walk through the guided demo (scenario, plan, approval, execution, stale-data conflict and partial failure), see [docs/demo-walkthrough.md](docs/demo-walkthrough.md).

## Connect an MCP client

**Local (stdio)** with Claude Desktop or any MCP host:

```json
{
  "mcpServers": {
    "agiloft-control": {
      "command": "node",
      "args": ["/absolute/path/to/agiloft-mcp/apps/mcp-server/dist/stdio.js"],
      "env": {
        "DATABASE_URL": "postgres://user:pass@localhost:5432/agiloft_control",
        "APP_ENCRYPTION_KEY": "<same key the console uses>",
        "MCP_STDIO_USER_EMAIL": "oli.operator@demo.local"
      }
    }
  }
}
```

**Remote (Streamable HTTP)**: `https://<host>/mcp`, with bearer tokens from your identity provider (audience = the MCP resource URL; scopes `agiloft:read`, `agiloft:plan`, `agiloft:execute`, `agiloft:audit`).

Details, including the MCP Inspector, are in [docs/mcp-clients.md](docs/mcp-clients.md).

### Tools

`connection_status`, `list_capabilities`, `list_tables`, `describe_table`, `search_records`, `get_record`, `get_related_records`, `prepare_record_create`, `prepare_record_update`, `analyse_scenario`, `create_change_plan`, `validate_change_plan`, `get_change_plan`, `execute_approved_plan`, `get_execution_status`, `get_audit_events`.

Some things are deliberately absent. There are no delete, raw SQL, arbitrary URL, script or approval tools. **Approval is only possible for a person in the console**: no tool argument (such as `approved=true`) can grant it, and the server rejects approval requests that arrive via MCP even from users with the approver role.

## Safety model in one paragraph

Every change is a **change plan** with an ID, version and SHA-256 content hash. It moves through **Draft → Validated → Awaiting approval → Approved → Executing → Succeeded / Partially succeeded / Failed / Cancelled**.

- **Approval binding:** an approval is bound to the plan version, hash, connection, environment and an expiry. Separation of duties is enforced on the server, and any change creates a new version and invalidates the approval.
- **Re-checks before execution:** the server re-validates against the live schema, the capability registry and the environment policy. Writes are off by default for every real environment.
- **Execution:** each update re-reads the record and refuses to write if it changed since the plan was prepared (stale-data detection). It holds an Agiloft record lock (`EWLock`) during the write.
- **Ambiguous writes:** a write whose outcome is unknown (a timeout or 5xx after sending) is **reconciled by reading** before anything is retried.
- **Durability:** execution state is persisted, claimed with leases (`FOR UPDATE SKIP LOCKED`) and survives restarts.
- **No rollback:** nothing is rolled back automatically. Partial completion is reported per operation, with recovery guidance.

The full model is in [docs/architecture.md](docs/architecture.md) and [docs/security.md](docs/security.md).

## What was verified, and how

Capabilities were checked against official Agiloft documentation on **2026-10-16**; see [docs/capability-matrix.md](docs/capability-matrix.md) and [docs/agiloft-research.md](docs/agiloft-research.md).

- **Verified in the documentation and used:** REST `/ewws` operations (`EWLogin` JWT, OAuth 2.0 client credentials, `EWTable`, `EWSearch`, `EWRead`, `EWCreate`, `EWUpdate`, `EWLock`) and Query-By-Example links. The documentation also confirms that rules fire on web-service changes ("Web" modification type).
- **Documented but not used:**
  - Disabled by policy: delete, SQL select, asynchronous writes, action buttons.
  - Not built yet: attachments, webhooks, OpenAPI fetch, upsert.
- **Unsupported (no documented external API):** creating or modifying tables, fields, rules, actions, layouts, permissions, workflows or OAuth clients. Optimistic concurrency is also undocumented; the substitute is the freshness check plus record lock.
- **Unverified / KB-specific:** workflow, approval and task templates stored as records. These are detected by schema discovery on each connection.

**Demo validation is not live validation.** The adapter contract tests exercise the documented request and response shapes against a local fake. Opt-in live tests exist (`packages/agiloft-client/src/live.test.ts`), but **have not been run against a real Agiloft instance** because no credentials were available.

## Testing

```bash
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test                         # unit + integration (embedded PGlite)
TEST_DATABASE_URL=postgres://… pnpm vitest run packages/core   # same safety suite on PostgreSQL
pnpm build && pnpm test:e2e       # Playwright demo journey, mobile layout, axe WCAG checks
```

[docs/testing.md](docs/testing.md) lists what each suite covers and how to run the opt-in live tests.

## Documentation

- [Architecture and data flow](docs/architecture.md)
- [Capability matrix](docs/capability-matrix.md) · [Agiloft research notes](docs/agiloft-research.md)
- [Security model, threat model and limitations](docs/security.md)
- [Configuration reference](docs/configuration.md) · [`.env.example`](.env.example)
- [Operations: setup, Docker, migrations, backup and restore](docs/operations.md)
- [Deployment guidance](docs/deployment.md)
- [Demo walkthrough](docs/demo-walkthrough.md)
- [MCP client configuration](docs/mcp-clients.md)
- [Testing](docs/testing.md)
- [Known limitations and roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)

## Licence

**No licence has been chosen.** The repository owner needs to select one before the code is distributed or reused. Until then, default copyright applies.
