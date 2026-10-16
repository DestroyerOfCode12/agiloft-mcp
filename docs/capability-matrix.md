# Agiloft capability matrix

> Generated from `packages/capabilities/src/registry.ts` by `pnpm docs:capabilities`. Do not edit by hand.

Official documentation checked: **2026-10-16** (Agiloft CLM Help, agiloft-public.atlassian.net).
The documentation pages do not state a single product version; they describe the current release line on that date.

**Documentation status** says what the official documentation states. It is not proof that a particular
instance behaves that way. **Instance status** is recorded per connection by a read-only probe and is shown in
the console's Capability Explorer; write capabilities cannot be confirmed without an opt-in sandbox test.

| Status      | Meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| verified    | The official documentation describes the capability and how to call it. |
| unverified  | Not established by the documentation; may depend on the KB.             |
| unsupported | No documented, externally callable mechanism was found.                 |
| restricted  | Exists but limited by licence or permissions.                           |

## Licensing

| ID                     | Capability           | Docs     | Agiloft Control | Mechanism | Limits / manual route                                                                   | Evidence                                                                                                               |
| ---------------------- | -------------------- | -------- | --------------- | --------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `licensing.api_access` | API access licensing | verified | Used            | —         | Edition is not reported by any documented API; confirm with your Agiloft administrator. | [API Web Services](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43716366/API+Web+Services) (2026-10-16) |

## Interface

| ID                  | Capability                      | Docs     | Agiloft Control     | Mechanism                                | Limits / manual route                                                                                                                                                                                    | Evidence                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------- | -------- | ------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interface.rest`    | REST interface (/ewws)          | verified | Used                | HTTPS GET/POST /ewws/EW{Operation}/.json | A delay (default one second, global variable WSDelay) is inserted after every REST call. Not recommended for bulk synchronisation; Agiloft recommends import or other integration methods for bulk work. | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16)<br>[API Web Services](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43716366/API+Web+Services) (2026-10-16) |
| `interface.openapi` | OpenAPI / Swagger documentation | verified | Not implemented yet | Swagger UI inside the KB; JSON download  | The OpenAPI document URL is not published in the documentation, so Agiloft Control does not fetch it automatically.                                                                                      | [OpenAPI Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/929595396/OpenAPI+Interface) (2026-10-16)                                                                                                                    |
| `interface.soap`    | SOAP web services               | verified | Disabled by policy  | —                                        | Not used: OpenAPI/REST are the documented recommendation.                                                                                                                                                | [API Web Services](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43716366/API+Web+Services) (2026-10-16)                                                                                                                       |

## Authentication

| ID                               | Capability                           | Docs     | Agiloft Control     | Mechanism                                                             | Limits / manual route                                                                                                                                                               | Evidence                                                                                                                                         |
| -------------------------------- | ------------------------------------ | -------- | ------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth.password_jwt`              | Login token (EWLogin JWT)            | verified | Used                | POST /ewws/EWLogin (credentials sent in the form body, never the URL) | Token lifetime defaults to 15 minutes (global variable token_expires_in, up to 60).                                                                                                 | [REST - Login](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714204/REST+-+Login) (2026-10-16)                                   |
| `auth.oauth2_client_credentials` | OAuth 2.0 client credentials         | verified | Used                | POST /ewws/otoken                                                     | Token expiry configurable 1–60 minutes (default 15). All calls run as the associated contact: a shared integration identity.                                                        | [Use OAuth2 to Access REST API](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43716464/Use+OAuth2+to+Access+REST+API) (2026-10-16) |
| `auth.oauth2_authorization_code` | OAuth 2.0 authorization code (+PKCE) | verified | Not implemented yet | /ewws/oauth then /ewws/otoken                                         | The documented scope binds permissions to the Contact ID in the client configuration, so this flow does not by itself give per-user identity. Planned for evaluation (see roadmap). | [Use OAuth2 to Access REST API](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43716464/Use+OAuth2+to+Access+REST+API) (2026-10-16) |
| `auth.url_credentials`           | Credentials in request parameters    | verified | Disabled by policy  | —                                                                     | Never used: credentials would appear in URLs and logs. Agiloft Control always uses a token.                                                                                         | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16)                               |

## Schema

| ID                     | Capability                         | Docs     | Agiloft Control | Mechanism                                                      | Limits / manual route                                                                                                                                                                                                                                                                               | Evidence                                                                                                       |
| ---------------------- | ---------------------------------- | -------- | --------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `schema.tables_fields` | Table and field metadata (EWTable) | verified | Used            | GET /ewws/EWTable/.json?$KB=..&table=..&includelinkedinfo=true | Related tables, action buttons, embedded searches and embedded communications are not returned. The JSON key of the required flag is not shown in the documentation example; when absent, Agiloft Control reports "required: unknown". Reading metadata does not imply permission to change schema. | [REST - Table](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715609/REST+-+Table) (2026-10-16) |
| `schema.linked_fields` | Linked-field relationships         | verified | Used            | EWTable includelinkedinfo=true                                 | Linked fields return only source table information.                                                                                                                                                                                                                                                 | [REST - Table](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715609/REST+-+Table) (2026-10-16) |

## Records

| ID                               | Capability                                    | Docs        | Agiloft Control              | Mechanism                                                                                                                                                        | Limits / manual route                                                                                                                                                                                                                                  | Evidence                                                                                                                                                                                                                         |
| -------------------------------- | --------------------------------------------- | ----------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `records.search`                 | Search records (EWSearch)                     | verified    | Used                         | GET /ewws/EWSearch/.json?query=..&field=..&page=..&limit=..                                                                                                      | Pages may shift or show gaps between calls because each REST call re-runs the query. No escape for single quotes inside values is documented; such values are rejected rather than guessed. Agiloft Control caps limit at 100 and never sends limit=0. | [REST - Search](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43717730/REST+-+Search) (2026-10-16)                                                                                                                 |
| `records.read`                   | Read record (EWRead)                          | verified    | Used                         | GET /ewws/EWRead/.json?id=..                                                                                                                                     | Agiloft Control only addresses records by numeric ID; $searchSQL is not exposed.                                                                                                                                                                       | [REST - Read](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714567/REST+-+Read) (2026-10-16)                                                                                                                     |
| `records.create`                 | Create record (EWCreate)                      | verified    | Used                         | POST /ewws/EWCreate/.json                                                                                                                                        | No idempotency key is documented. A create whose response is lost cannot be safely retried unless a unique field allows reconciliation.                                                                                                                | [REST - Create](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714571/REST+-+Create) (2026-10-16)                                                                                                                 |
| `records.update`                 | Update record (EWUpdate)                      | verified    | Used                         | POST /ewws/EWUpdate/.json                                                                                                                                        | Agiloft Control never sends $operationHints=NOLOCK. No conditional (compare-and-set) update is documented.                                                                                                                                             | [REST - Update](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714575/REST+-+Update) (2026-10-16)                                                                                                                 |
| `records.optimistic_concurrency` | Optimistic concurrency control                | unsupported | Not available (manual route) | Substitute: freshness check (re-read and compare captured values) immediately before each update, plus an EWLock record lock held for the duration of the write. | A small race window remains between the freshness read and the update if another client ignores record locks.                                                                                                                                          | [REST - Update](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714575/REST+-+Update) (2026-10-16)<br>[REST - Lock](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714340/REST+-+Lock) (2026-10-16) |
| `records.lock`                   | Record lock (EWLock)                          | verified    | Used                         | GET/PUT/DELETE /ewws/EWLock/.json?$table=..&id=..                                                                                                                | Agiloft Control never uses force.                                                                                                                                                                                                                      | [REST - Lock](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714340/REST+-+Lock) (2026-10-16)                                                                                                                     |
| `records.link_by_value`          | Set linked fields by value (Query By Example) | verified    | Used                         | field=:value in EWCreate/EWUpdate                                                                                                                                | If more than one record matches, Agiloft rejects the write. The "?" SQL form is not used.                                                                                                                                                              | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16)                                                                                                               |
| `records.delete`                 | Delete record (EWDelete)                      | verified    | Disabled by policy           | —                                                                                                                                                                | Not exposed by default: destructive and irreversible.                                                                                                                                                                                                  | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16)                                                                                                               |
| `records.select_sql`             | SQL select (EWSelect) and $searchSQL          | verified    | Disabled by policy           | —                                                                                                                                                                | Not exposed: raw SQL fragments are not accepted from callers.                                                                                                                                                                                          | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16)                                                                                                               |
| `records.upsert`                 | Upsert (EWUpsert)                             | verified    | Not implemented yet          | —                                                                                                                                                                | Not used: plans state explicitly whether they create or update so reviewers see exact effects.                                                                                                                                                         | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16)                                                                                                               |
| `records.async_decorator`        | Asynchronous ("fire-and-forget") writes       | verified    | Disabled by policy           | —                                                                                                                                                                | Not used: per-operation results are required for audit and reconciliation.                                                                                                                                                                             | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16)                                                                                                               |

## Automation

| ID                               | Capability                                  | Docs       | Agiloft Control     | Mechanism                                        | Limits / manual route                                                                                                                                                                                                        | Evidence                                                                                                           |
| -------------------------------- | ------------------------------------------- | ---------- | ------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `records.rules_triggered_by_api` | Business rules run on API writes            | verified   | Used                | Native Agiloft behaviour                         | Any create or update may trigger rules configured for "Web" changes, including emails, field updates, record creation and deletion. These effects cannot be enumerated through any documented API and may not be reversible. | [Rules](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714473/Rules) (2026-10-16)                   |
| `automation.action_button`       | Run action button (EWActionButton)          | verified   | Disabled by policy  | —                                                | Blocked by default: the effects of an action button cannot be inspected through a documented API.                                                                                                                            | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16) |
| `automation.webhooks`            | Outbound webhooks                           | verified   | Not implemented yet | —                                                | Relevant only to the "external orchestration" route, which requires a publicly reachable receiver.                                                                                                                           | [Webhooks](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714342/Webhooks) (2026-10-16)             |
| `automation.workflow_records`    | Workflow/approval/task templates as records | unverified | Used                | Record create/update on detected template tables | Only treated as available when schema discovery finds the relevant tables on the connected KB.                                                                                                                               | [Rules](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714473/Rules) (2026-10-16)                   |

## Attachments

| ID                  | Capability                    | Docs     | Agiloft Control     | Mechanism | Limits / manual route                                                                           | Evidence                                                                                                           |
| ------------------- | ----------------------------- | -------- | ------------------- | --------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `attachments.read`  | Attachment info and retrieval | verified | Not implemented yet | —         | Planned for phase 2 with content-type allow-listing, size limits and untrusted-content framing. | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16) |
| `attachments.write` | Add or remove attachments     | verified | Not implemented yet | —         | Not implemented in this release.                                                                | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16) |

## Administration

| ID                    | Capability                     | Docs        | Agiloft Control              | Mechanism | Limits / manual route                                                                                                                                                                                                                                                                      | Evidence                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------ | ----------- | ---------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin.tables`        | Create or modify tables        | unsupported | Not available (manual route) | —         | No external callable API found in official documentation. Not attempted through undocumented endpoints, database access or browser automation. Manual: Setup > Tables, then New or Edit (Table wizard).                                                                                    | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16)                                                                                                                                                     |
| `admin.fields`        | Create or modify fields        | unsupported | Not available (manual route) | —         | No external callable API found in official documentation. Not attempted through undocumented endpoints, database access or browser automation. Manual: Field wizard in the table setup screens (menu path not verified by Agiloft Control; see the Agiloft Administrator Guide).           | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16)                                                                                                                                                     |
| `admin.rules`         | Create, read or modify rules   | unsupported | Not available (manual route) | —         | No external callable API found in official documentation. Not attempted through undocumented endpoints, database access or browser automation. Manual: Setup > Rules or Setup [Table] > Rules tab (Rules wizard: General, Rule Type, Condition, Schedule, Action tabs).                    | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16)<br>[Rules](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714473/Rules) (2026-10-16)                                                 |
| `admin.actions`       | Create or modify actions       | unsupported | Not available (manual route) | —         | No external callable API found in official documentation. Not attempted through undocumented endpoints, database access or browser automation. Manual: Action tab of the Rules wizard (Setup [Table] > Rules).                                                                             | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16)                                                                                                                                                     |
| `admin.layouts`       | Modify layouts                 | unsupported | Not available (manual route) | —         | No external callable API found in official documentation. Not attempted through undocumented endpoints, database access or browser automation. Manual: Layout configuration in the table setup screens (menu path not verified by Agiloft Control; see the Agiloft Administrator Guide).   | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16)                                                                                                                                                     |
| `admin.permissions`   | Modify groups and permissions  | unsupported | Not available (manual route) | —         | No external callable API found in official documentation. Not attempted through undocumented endpoints, database access or browser automation. Manual: Group and permission configuration in Setup (menu path not verified by Agiloft Control; see the Agiloft Administrator Guide).       | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16)                                                                                                                                                     |
| `admin.workflows`     | Modify workflow state machines | unsupported | Not available (manual route) | —         | No external callable API found in official documentation. Not attempted through undocumented endpoints, database access or browser automation. Manual: Workflow configuration in the table setup screens (menu path not verified by Agiloft Control; see the Agiloft Administrator Guide). | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16)                                                                                                                                                     |
| `admin.oauth_clients` | Manage OAuth clients           | unsupported | Not available (manual route) | —         | No external callable API found in official documentation. Not attempted through undocumented endpoints, database access or browser automation. Manual: Setup > Integration > OAuth2 Client Setup.                                                                                          | [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface) (2026-10-16)<br>[Use OAuth2 to Access REST API](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43716464/Use+OAuth2+to+Access+REST+API) (2026-10-16) |

## Findings in detail

### `licensing.api_access` — API access licensing

Whether the KB edition includes API web services.

- Documentation status: **verified**; Agiloft Control: **Used**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: —
- Instance probe: read only probe
- Evidence: [API Web Services](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43716366/API+Web+Services), checked 2026-10-16: API services are available with the Platform edition of Agiloft CLM; on older editions they require an Advanced or Premium edition.

### `interface.rest` — REST interface (/ewws)

Record, metadata, lock and attachment operations over HTTPS.

- Documentation status: **verified**; Agiloft Control: **Used**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.
- Instance probe: read only probe
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: Operations are exposed under /ewws/{operation} with $KB, $table and $lang parameters; a /.json decorator returns JSON.
- Evidence: [API Web Services](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43716366/API+Web+Services), checked 2026-10-16: REST services are enabled by default but restricted by group permissions and license types.

### `interface.openapi` — OpenAPI / Swagger documentation

Per-KB generated OpenAPI specification covering the KB’s tables and fields.

- Documentation status: **verified**; Agiloft Control: **Not implemented yet**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Agiloft administrator to open Setup > System
- Instance probe: none
- Evidence: [OpenAPI Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/929595396/OpenAPI+Interface), checked 2026-10-16: Swagger UI is available in the KB at Setup > System > View REST documentation, with a downloadable OpenAPI JSON file. The page states there are currently no rate limits per user, token or KB.

### `interface.soap` — SOAP web services

Legacy SOAP interface.

- Documentation status: **verified**; Agiloft Control: **Disabled by policy**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: —
- Instance probe: none
- Evidence: [API Web Services](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43716366/API+Web+Services), checked 2026-10-16: SOAP services are disabled by default and are not recommended for new integrations.

### `auth.password_jwt` — Login token (EWLogin JWT)

Exchange integration-user credentials for a short-lived bearer token.

- Documentation status: **verified**; Agiloft Control: **Used**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.
- Instance probe: read only probe
- Evidence: [REST - Login](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714204/REST+-+Login), checked 2026-10-16: POST /ewws/EWLogin with $KB, $login, $password, $lang returns access_token, refresh_token, expires_in and authentication_scheme (Bearer). Default expiry 15 minutes; EWLogout ends the session.

### `auth.oauth2_client_credentials` — OAuth 2.0 client credentials

Machine-to-machine token for a service account configured in the KB.

- Documentation status: **verified**; Agiloft Control: **Used**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: OAuth2 client configured and enabled by an Agiloft administrator
- Instance probe: read only probe
- Evidence: [Use OAuth2 to Access REST API](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43716464/Use+OAuth2+to+Access+REST+API), checked 2026-10-16: Client credentials flow: POST /ewws/otoken with grant_type=client_credentials, client_id, client_secret (application/x-www-form-urlencoded). Clients are configured at Setup > Integration > OAuth2 Client Setup and bound to a Contact ID whose permissions apply.

### `auth.oauth2_authorization_code` — OAuth 2.0 authorization code (+PKCE)

User-centric OAuth flow that could let actions run under an individual identity.

- Documentation status: **verified**; Agiloft Control: **Not implemented yet**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: OAuth2 client configured by an Agiloft administrator
- Instance probe: none
- Evidence: [Use OAuth2 to Access REST API](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43716464/Use+OAuth2+to+Access+REST+API), checked 2026-10-16: Authorization Code (with PKCE) is supported via /ewws/oauth; scope is permissions_for:CONTACT_ID as defined in the client configuration; refresh tokens expire after 28 days of inactivity.

### `auth.url_credentials` — Credentials in request parameters

$login/$password on each request.

- Documentation status: **verified**; Agiloft Control: **Disabled by policy**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: —
- Instance probe: none
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: Each operation accepts $login and $password parameters; POST bodies can conceal them.

### `schema.tables_fields` — Table and field metadata (EWTable)

List tables with label and logical name; list fields with name, label, type and required flag.

- Documentation status: **verified**; Agiloft Control: **Used**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.
- Instance probe: read only probe
- Evidence: [REST - Table](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715609/REST+-+Table), checked 2026-10-16: EWTable returns tables (label, logicalName) and fields (name, label, type, required flag). Parameters: table, includelinkedinfo, skipColumnsInfo. Action buttons, related tables, embedded search results and embedded communications are not supported. Requires EWLogin or OAuth 2.0.

### `schema.linked_fields` — Linked-field relationships

Source table and column for linked fields.

- Documentation status: **verified**; Agiloft Control: **Used**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.
- Instance probe: read only probe
- Evidence: [REST - Table](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715609/REST+-+Table), checked 2026-10-16: With includelinkedinfo=true, linked fields return isLinked and linkedInfo (linkedTable, linkedColumn).

### `records.search` — Search records (EWSearch)

Ad hoc queries with field selection and pagination.

- Documentation status: **verified**; Agiloft Control: **Used**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.
- Instance probe: read only probe
- Evidence: [REST - Search](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43717730/REST+-+Search), checked 2026-10-16: Operators =, !=, ~= (contains), <, <=, >, >=, && and ||; values in single quotes; null for empty. Pagination with page (from 0) and limit; limit 0 returns all records. The REST interface creates a new session per call, so the query is rebuilt and re-run each time.

### `records.read` — Read record (EWRead)

Retrieve a record by ID.

- Documentation status: **verified**; Agiloft Control: **Used**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.
- Instance probe: read only probe
- Evidence: [REST - Read](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714567/REST+-+Read), checked 2026-10-16: EWRead returns the encoded data of the record identified by id (or a $searchSQL that matches exactly one record).

### `records.create` — Create record (EWCreate)

Create a record with field values.

- Documentation status: **verified**; Agiloft Control: **Used**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.; Create permission on the target table
- Instance probe: requires sandbox write
- Evidence: [REST - Create](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714571/REST+-+Create), checked 2026-10-16: EWCreate creates a record in the specified KB and table and returns the new record ID. Content-Type application/x-www-form-urlencoded.

### `records.update` — Update record (EWUpdate)

Update fields on an existing record.

- Documentation status: **verified**; Agiloft Control: **Used**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.; Edit permission on the target table and fields
- Instance probe: requires sandbox write
- Evidence: [REST - Update](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714575/REST+-+Update), checked 2026-10-16: EWUpdate updates the specified record and returns its final contents. $operationHints=NOLOCK forces an update of a locked record.

### `records.optimistic_concurrency` — Optimistic concurrency control

Conditional update that fails if the record changed since it was read.

- Documentation status: **unsupported**; Agiloft Control: **Not available (manual route)**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.
- Instance probe: none
- Evidence: [REST - Update](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714575/REST+-+Update), checked 2026-10-16: No version, ETag or conditional update parameter is documented for EWUpdate.
- Evidence: [REST - Lock](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714340/REST+-+Lock), checked 2026-10-16: EWLock can check (GET), lock (PUT) and unlock (DELETE) a record; responses include lock_status, locked_by and lock_expires_in_minutes.

### `records.lock` — Record lock (EWLock)

Check, acquire and release a record lock.

- Documentation status: **verified**; Agiloft Control: **Used**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.
- Instance probe: read only probe
- Evidence: [REST - Lock](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714340/REST+-+Lock), checked 2026-10-16: GET checks, PUT locks and DELETE unlocks a record. force allows admins to unlock a record locked by another user.

### `records.link_by_value` — Set linked fields by value (Query By Example)

Link a record to another by the value of an imported column.

- Documentation status: **verified**; Agiloft Control: **Used**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.
- Instance probe: requires sandbox write
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: Linked fields are set using Query By Example: field=:value or field=Table:value; ":" and "?" in values must be escaped with a backslash.

### `records.rules_triggered_by_api` — Business rules run on API writes

Whether event rules fire when records change through web services.

- Documentation status: **verified**; Agiloft Control: **Used**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: —
- Instance probe: none
- Evidence: [Rules](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714473/Rules), checked 2026-10-16: Event-specific rules can be limited by "Only when the change occurs by means of" Email, Web or API. "Web" also covers changes made by a Web Service call; "API" refers to internal Agiloft APIs (rules and actions), not external web APIs.

### `records.delete` — Delete record (EWDelete)

Permanently delete a record.

- Documentation status: **verified**; Agiloft Control: **Disabled by policy**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.; Delete permission
- Instance probe: none
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: EWDelete (GET/POST/DELETE) deletes a record and returns nothing.

### `records.select_sql` — SQL select (EWSelect) and $searchSQL

Limited SQL selection.

- Documentation status: **verified**; Agiloft Control: **Disabled by policy**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.
- Instance probe: none
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: EWSelect supports limited SQL select functionality and returns record identifiers.

### `records.upsert` — Upsert (EWUpsert)

Create or update depending on a match.

- Documentation status: **verified**; Agiloft Control: **Not implemented yet**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.
- Instance probe: none
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: EWUpsert (POST) creates a new record or updates an existing record.

### `records.async_decorator` — Asynchronous ("fire-and-forget") writes

/ewws/async/ decorator for create, update and delete.

- Documentation status: **verified**; Agiloft Control: **Disabled by policy**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.
- Instance probe: none
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: The asynchronous decorator applies to EWCreate, EWUpdate and EWDelete; EWAsyncStatus checks status.

### `attachments.read` — Attachment info and retrieval

EWAttachInfo and EWRetrieve.

- Documentation status: **verified**; Agiloft Control: **Not implemented yet**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.
- Instance probe: none
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: EWAttachInfo returns information about a record’s attachments; EWRetrieve retrieves an attachment.

### `attachments.write` — Add or remove attachments

EWAttach (PUT) and EWRemoveAttachment.

- Documentation status: **verified**; Agiloft Control: **Not implemented yet**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.
- Instance probe: none
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: EWAttach (PUT) adds an attachment; EWRemoveAttachment removes one; multipart/form-data accepted on file fields.

### `automation.action_button` — Run action button (EWActionButton)

Run a configured action button on a record.

- Documentation status: **verified**; Agiloft Control: **Disabled by policy**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.
- Instance probe: none
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: EWActionButton (POST) runs an action button from a specified record.

### `automation.webhooks` — Outbound webhooks

Register HTTPS callbacks for create/update/delete events.

- Documentation status: **verified**; Agiloft Control: **Not implemented yet**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Webhooks Setup deployed in the KB
- Instance probe: none
- Evidence: [Webhooks](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714342/Webhooks), checked 2026-10-16: Webhooks can be registered with POST /ewws/webhooks or in Setup > Integration > Webhooks Setup. Agiloft POSTs to a public HTTPS URL and retries up to five times.

### `automation.workflow_records` — Workflow/approval/task templates as records

Some KBs store workflow, approval or task templates in ordinary tables that are editable through record APIs.

- Documentation status: **unverified**; Agiloft Control: **Used**
- Applies to: KB-specific. Detected through schema discovery on each connection.
- Required permissions: Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.
- Instance probe: schema detection
- Evidence: [Rules](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714473/Rules), checked 2026-10-16: Example rule: "When a user selects a workflow in a Service Request, automatically create Task records linked to that workflow." Whether such templates exist is KB-specific.

### `admin.tables` — Create or modify tables

Programmatic table creation or changes.

- Documentation status: **unsupported**; Agiloft Control: **Not available (manual route)**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Agiloft administrator (admin group) in the Agiloft UI
- Instance probe: none
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: The API Web Services, REST Interface and OpenAPI Interface pages list record, attachment, lock, metadata, saved-search, action-button, hotlink and webhook operations only. No operation for creating or modifying this configuration is documented; the documented method is the Setup wizards in the Agiloft UI.

### `admin.fields` — Create or modify fields

Programmatic field creation or changes.

- Documentation status: **unsupported**; Agiloft Control: **Not available (manual route)**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Agiloft administrator (admin group) in the Agiloft UI
- Instance probe: none
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: The API Web Services, REST Interface and OpenAPI Interface pages list record, attachment, lock, metadata, saved-search, action-button, hotlink and webhook operations only. No operation for creating or modifying this configuration is documented; the documented method is the Setup wizards in the Agiloft UI.

### `admin.rules` — Create, read or modify rules

Programmatic access to business rules.

- Documentation status: **unsupported**; Agiloft Control: **Not available (manual route)**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Agiloft administrator (admin group) in the Agiloft UI
- Instance probe: none
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: The API Web Services, REST Interface and OpenAPI Interface pages list record, attachment, lock, metadata, saved-search, action-button, hotlink and webhook operations only. No operation for creating or modifying this configuration is documented; the documented method is the Setup wizards in the Agiloft UI.
- Evidence: [Rules](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43714473/Rules), checked 2026-10-16: Rules are created and edited with the Rules wizard (Setup [Table] > Rules, or Setup > Rules).

### `admin.actions` — Create or modify actions

Email, update-fields, validate, linked-record and other actions.

- Documentation status: **unsupported**; Agiloft Control: **Not available (manual route)**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Agiloft administrator (admin group) in the Agiloft UI
- Instance probe: none
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: The API Web Services, REST Interface and OpenAPI Interface pages list record, attachment, lock, metadata, saved-search, action-button, hotlink and webhook operations only. No operation for creating or modifying this configuration is documented; the documented method is the Setup wizards in the Agiloft UI.

### `admin.layouts` — Modify layouts

Form and list layouts.

- Documentation status: **unsupported**; Agiloft Control: **Not available (manual route)**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Agiloft administrator (admin group) in the Agiloft UI
- Instance probe: none
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: The API Web Services, REST Interface and OpenAPI Interface pages list record, attachment, lock, metadata, saved-search, action-button, hotlink and webhook operations only. No operation for creating or modifying this configuration is documented; the documented method is the Setup wizards in the Agiloft UI.

### `admin.permissions` — Modify groups and permissions

Group, table and field permissions.

- Documentation status: **unsupported**; Agiloft Control: **Not available (manual route)**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Agiloft administrator (admin group) in the Agiloft UI
- Instance probe: none
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: The API Web Services, REST Interface and OpenAPI Interface pages list record, attachment, lock, metadata, saved-search, action-button, hotlink and webhook operations only. No operation for creating or modifying this configuration is documented; the documented method is the Setup wizards in the Agiloft UI.

### `admin.workflows` — Modify workflow state machines

Workflow states and transitions.

- Documentation status: **unsupported**; Agiloft Control: **Not available (manual route)**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Agiloft administrator (admin group) in the Agiloft UI
- Instance probe: none
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: The API Web Services, REST Interface and OpenAPI Interface pages list record, attachment, lock, metadata, saved-search, action-button, hotlink and webhook operations only. No operation for creating or modifying this configuration is documented; the documented method is the Setup wizards in the Agiloft UI.

### `admin.oauth_clients` — Manage OAuth clients

Creating OAuth2 client registrations.

- Documentation status: **unsupported**; Agiloft Control: **Not available (manual route)**
- Applies to: Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.
- Required permissions: Agiloft administrator (admin group) in the Agiloft UI
- Instance probe: none
- Evidence: [REST Interface](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43715778/REST+Interface), checked 2026-10-16: The API Web Services, REST Interface and OpenAPI Interface pages list record, attachment, lock, metadata, saved-search, action-button, hotlink and webhook operations only. No operation for creating or modifying this configuration is documented; the documented method is the Setup wizards in the Agiloft UI.
- Evidence: [Use OAuth2 to Access REST API](https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages/43716464/Use+OAuth2+to+Access+REST+API), checked 2026-10-16: OAuth clients are configured in Setup > Integration > OAuth2 Client Setup.
