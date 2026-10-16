# Agiloft research notes

Date checked: **2026-10-16**. Method: the official Agiloft CLM Help pages were retrieved and read. No Agiloft instance was available, so **nothing below has been verified against a running instance**.

The complete per-capability list, with evidence links, is generated in [capability-matrix.md](capability-matrix.md). This page summarises the findings that shaped the design.

## Sources read

| Page                                 | URL                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| API Web Services                     | https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43716366/API+Web+Services |
| REST Interface                       | https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface   |
| REST - Table                         | https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715609/REST+-+Table     |
| REST - Search                        | https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43717730/REST+-+Search    |
| REST - Login                         | https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714204/REST+-+Login     |
| REST - Create / Read / Update / Lock | pages 43714571, 43714567, 43714575, 43714340                                          |
| Use OAuth2 to Access REST API        | https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43716464                  |
| OpenAPI Interface                    | https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/929595396                 |
| Webhooks                             | https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714342                  |
| Rules                                | https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714473/Rules            |

## Findings

### Interfaces and licensing

- OpenAPI (recommended for new integrations), REST and SOAP exist. SOAP is disabled by default and not recommended.
- API services come with the Platform edition; older editions need Advanced or Premium.
- REST is enabled by default but restricted by group permissions and licence type.

### Authentication

- `EWLogin` exchanges `$KB`, `$login`, `$password` and `$lang` for `access_token`, `refresh_token`, `expires_in` and `authentication_scheme` (`Bearer`). The default lifetime is 15 minutes (global variable `token_expires_in`, up to 60).
- OAuth 2.0 supports two flows, both configured at Setup > Integration > OAuth2 Client Setup and bound to a Contact ID:
  - authorization code (with PKCE), via `/ewws/oauth`;
  - client credentials, via `/ewws/otoken`.
- The OAuth page describes `expires_in` as minutes but its example shows `3600`. The adapter treats values of 60 or less as minutes and larger values as seconds, so the shorter plausible lifetime wins.

### Records

- Operations are under `/ewws/EW{Operation}`; the `/.json` decorator returns `{"success","message","result"}`, and `err_code_resp=1` returns real HTTP status codes. POST bodies may carry the parameters.
- Every REST call has an inserted delay (default one second, `WSDelay`).
- Search syntax: `=`, `!=`, `~=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, single-quoted values, `null` for empty.
  - Pagination uses `page` (0-based) and `limit`; `limit=0` returns everything, which Agiloft Control never sends.
  - Each REST call rebuilds the query, so pages may shift between calls.
  - **No escape for a single quote inside a value is documented.** Such values are rejected.
- `EWUpdate` returns the updated record. `$operationHints=NOLOCK` forces an update of a locked record (never used). No version, ETag or conditional update is documented.
- `EWLock`: GET checks, PUT locks, DELETE unlocks; `force` is for administrators.
- Linked fields are set by Query By Example (`field=:value` or `field=Table:value`, escaping `:` and `?`). A `?` SQL form exists; it is not used.
- Create, read, update, delete, select (SQL), upsert, attach, retrieve, attach-info, action button, saved search, async status, choice-line-ID and hotlink operations are all documented.

### Schema

`EWTable` returns tables (label, logical name) and fields (name, label, type, required flag), plus linked-field information with `includelinkedinfo=true`. It does not return action buttons, related tables, embedded searches or communications. The documentation example does not show the JSON key of the required flag, so the adapter reports "unknown" when it is absent.

### Rules and automation

- Event rules can be limited by modification type: **Email**, **Web** and **API**.
  - **"Web" includes changes made by Web Service calls.**
  - **"API"** means internal Agiloft APIs (rules and actions), not external web APIs.
  - Therefore **writes through REST can trigger rules**, including emails, field updates and record creation or deletion.
- Rules are configured in the **Rules wizard** (General, Rule Type, Condition, Schedule, Action tabs).
- Time-based rules run at most every five minutes on Agiloft-hosted KBs. Only one time-based or summary rule runs per KB at a time by default. Errors are emailed to the admin team.
- Rules can be restricted to a team's working hours (Schedule tab).
- **Webhooks** (outbound to a public HTTPS URL) can be registered via `POST /ewws/webhooks` or Setup > Integration > Webhooks Setup. They are relevant only to an external-orchestration route.

### Workflow templates as records

Whether workflow, approval or task templates are stored as ordinary records depends on the KB. The Rules documentation gives an example of creating Task records from a selected workflow. Agiloft Control treats this as available only when schema discovery finds such tables.

### Administration

No page lists an operation for creating or modifying tables, fields, rules, actions, layouts, groups or permissions, or workflows, and the OpenAPI page describes record endpoints for tables and fields only. These capabilities are recorded as **unsupported (no documented external API)**. Agiloft Control does not attempt them through undocumented endpoints, database writes or browser automation.

## Open questions for a live instance

1. The JSON shape of `EWSearch` results (the parser accepts an array, or an object containing one array of records with a numeric count).
2. The JSON key for the required flag in `EWTable`.
3. Which date formats `EWCreate`/`EWUpdate` accept for this KB. The adapter sends `MMM DD YYYY HH:mm`, the format used in the documented search example.
4. Whether `EWLock` PUT fails when another user holds the lock, or reports `LOCKED` with a different `locked_by`.
5. The OAuth `expires_in` unit.
6. Whether the integration account's group can read `date_updated` on the target tables, which the freshness check depends on.

The opt-in live tests and the connection probe (Connections → Test connection) are designed to answer 1–2 and 6 read-only; 3–5 need the sandbox write tests.
