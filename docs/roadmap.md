# Known limitations and roadmap

## Known limitations

- **No live Agiloft validation yet.** Everything is tested against the demo adapter and a documentation-shaped fake. Run the opt-in live tests ([testing.md](testing.md)) before relying on a live connection.
- **No platform administration.** Tables, fields, rules, actions, layouts, permissions and workflows have no documented external API. Plans describe these as manual steps.
- **Shared integration identity.** Agiloft attributes every change to the connection's integration account.
- **Rule side effects are opaque.** Rule definitions cannot be read through a documented API, so plans can only warn that rules may fire.
- **No optimistic concurrency in Agiloft.** Freshness checks plus record locks narrow, but do not eliminate, the race window.
- **No rollback.** Recovery is manual and guided by the plan's compensating actions.
- **Attachments are not implemented**, although the APIs are documented.
- **Scenario interpretation is pattern-based** unless a model provider is configured. Unrecognised sentences are listed, not guessed.
- **The planner's template mapping is heuristic.** It looks for tables whose names contain workflow, approval or task template. KBs with different conventions need structured requirements, or plans written directly.
- **EWSearch total counts** depend on the response shape. When Agiloft reports no total, pagination shows "unknown".
- **Audit log** is not tamper-proof (see [security.md](security.md)).
- **Encryption key rotation** requires re-entering credentials.
- **MCP rate limiting** is per process.
- **The container image has not been built in this environment** (no Docker daemon was available). CI builds it.

## Phased roadmap

### Phase 1 (this release)

Read-only discovery, plan-based record create and update, approvals, durable execution, demo mode, console, MCP over stdio and HTTP.

### Phase 2: live hardening

- [ ] Run the live read-only and sandbox suites against a real KB and resolve the open questions in [agiloft-research.md](agiloft-research.md).
- [ ] Attachments: `EWAttachInfo` / `EWRetrieve` with content-type allow-list, size limits and untrusted framing; `EWAttach` via plans.
- [ ] Use the per-KB OpenAPI document (if retrievable via a documented URL) to cross-check field metadata.
- [ ] Opaque token introspection (RFC 7662) for remote MCP.
- [ ] Key rotation with re-encryption of stored credentials.

### Phase 3: richer planning

- [ ] Saved-search-based record selection in plans (documented `search=` parameter).
- [ ] Bulk update plans with per-record freshness checks and throttling that respects `WSDelay`.
- [ ] Plan diff view between versions.
- [ ] Rule _checklists_ generated from scenario analysis, exportable to the KB's change process.

### Phase 4: optional adapters (each requires an explicit decision)

- [ ] Webhook receiver for external orchestration (needs a publicly reachable endpoint and its own threat model).
- [ ] Evaluate OAuth authorization code with PKCE for per-user Agiloft identity, if Agiloft supports binding to individual contacts.
- [ ] **Browser automation for administration** is out of scope. If ever introduced, it must be a separate, explicitly approved adapter with its own capability entries and audit trail.

## Licence

No licence has been selected. The repository owner must decide.
