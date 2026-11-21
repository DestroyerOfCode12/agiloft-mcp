# MCP client configuration

Agiloft Control implements MCP with the official TypeScript SDK v2 (`@modelcontextprotocol/server` 2.3.1, specification revision 2026-07-28). 2025-era clients are also served, statelessly.

## Local: stdio

Build first (`pnpm build`), then point the MCP host at `apps/mcp-server/dist/stdio.js`. The stdio process acts as an existing Agiloft Control user (`MCP_STDIO_USER_EMAIL`) and is limited by that user's roles. stdout carries only protocol messages; logs go to stderr.

**Share state with the console.** Use the same PostgreSQL `DATABASE_URL` and `APP_ENCRYPTION_KEY` as the console. Approvals given in the console then apply to plans the assistant created, and a worker running alongside the console executes them.

**Standalone demo.** Without a database URL, the stdio server uses its own embedded PGlite database (a separate demo state from the console). Set `MCP_STDIO_RUN_WORKER=true` so approved plans execute.

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "agiloft-control": {
      "command": "node",
      "args": ["/absolute/path/to/agiloft-mcp/apps/mcp-server/dist/stdio.js"],
      "env": {
        "DATABASE_URL": "postgres://agiloft_control:password@localhost:5432/agiloft_control",
        "APP_ENCRYPTION_KEY": "<same key the console uses>",
        "MCP_STDIO_USER_EMAIL": "oli.operator@demo.local",
        "LOG_LEVEL": "warn"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add agiloft-control -- node /absolute/path/to/agiloft-mcp/apps/mcp-server/dist/stdio.js
```

### MCP Inspector

```bash
pnpm mcp:inspect                                  # interactive UI against the stdio server (tsx)
npx -y @modelcontextprotocol/inspector@2.11.0 --cli \
  -e DATABASE_URL=pglite:memory --connect-timeout 120000 \
  node apps/mcp-server/dist/stdio.js --method tools/list
```

CI runs the second command and checks that all 16 tools are listed. `--strict` reports no schema-portability warnings.

## Remote: Streamable HTTP

Endpoint: `MCP_RESOURCE_URL`, for example `https://control.example.com/mcp`.

The endpoint is started by the console API when `MCP_OAUTH_ISSUER` or `MCP_DEV_TOKEN` is set, or standalone with `node apps/mcp-server/dist/http.js`.

**Authentication.** OAuth 2.1 bearer tokens are issued by your identity provider; Agiloft Control is a resource server only.

- An unauthenticated request receives `401` with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"`.
- MCP clients that implement the authorisation specification use that document to discover the authorization server.

**Scopes:**

| Scope             | Allows                                                             |
| ----------------- | ------------------------------------------------------------------ |
| `agiloft:read`    | Required. Status, capabilities, schema, records, plans, executions |
| `agiloft:plan`    | Prepare, create and validate or submit plans                       |
| `agiloft:execute` | Execute approved plans, cancel executions                          |
| `agiloft:audit`   | Read audit events (also needs the approver or admin role)          |

**Token checks:** issuer, signature (JWKS), expiry, and audience equal to the resource URL. The subject must belong to an existing Agiloft Control user, who signs in to the console once and is granted roles. Tokens are never forwarded to Agiloft.

**Local development:** set `MCP_DEV_TOKEN` (24+ characters; refused in production) and send `Authorization: Bearer <token>`. The token acts as `MCP_DEV_TOKEN_USER_EMAIL`.

```json
{
  "mcpServers": {
    "agiloft-control-remote": {
      "type": "http",
      "url": "http://localhost:8090/mcp",
      "headers": { "Authorization": "Bearer <MCP_DEV_TOKEN>" }
    }
  }
}
```

## Tools

| Tool                                              | Annotations                    | Purpose                                                                             |
| ------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| `connection_status`                               | read-only, open world          | Connections, environments, last verification; `refresh` re-runs the read-only probe |
| `list_capabilities`                               | read-only                      | Capability registry with evidence and per-connection status                         |
| `list_tables` / `describe_table`                  | read-only, open world          | Schema discovery (EWTable)                                                          |
| `search_records`                                  | read-only, open world          | Structured filters → documented query syntax; bounded pages                         |
| `get_record` / `get_related_records`              | read-only, open world          | Record and linked records (untrusted-data envelope)                                 |
| `prepare_record_create` / `prepare_record_update` | writes to Agiloft Control only | Create a validated plan; captures before values                                     |
| `analyse_scenario`                                | read-only                      | 13-category breakdown with implementation routes                                    |
| `create_change_plan`                              | writes to Agiloft Control only | From a scenario or a complete plan document                                         |
| `validate_change_plan`                            | writes to Agiloft Control only | Re-validate; optionally submit for approval                                         |
| `get_change_plan`                                 | read-only                      | Full plan document with approval and execution state                                |
| `execute_approved_plan`                           | **destructive**, open world    | Queue an approved plan (approval checked server-side)                               |
| `get_execution_status`                            | read-only                      | Per-operation results and recovery guidance                                         |
| `get_audit_events`                                | read-only                      | Redacted audit events (approver or admin)                                           |

## Resources

- `agiloft-control://guide`: workflow and safety model
- `agiloft-control://capabilities`: capability registry JSON
- `agiloft-control://schemas/change-plan`: JSON Schema of `agiloft-control/change-plan@1`
- `agiloft-control://connections/{connectionId}/tables/{table}`: table schema
