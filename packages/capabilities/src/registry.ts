import type { CapabilityDefinition, Evidence } from './types.ts';

/**
 * Capability registry. Every entry cites the official Agiloft documentation it
 * was checked against. "verified" here means *documentation* verification only;
 * verification against a connected instance is tracked separately per connection.
 *
 * Documentation checked: Agiloft CLM Help (agiloft-public.atlassian.net), 2026-10-16.
 * The documentation does not state a single product version number for these
 * pages; they describe the current release line at the date checked.
 */

export const DOCS_CHECKED_AT = '2026-10-16';
const BASE = 'https://agiloft-public.atlassian.net/wiki/spaces/HELP/pages';

const doc = (path: string, title: string, finding: string): Evidence => ({
  url: `${BASE}/${path}`,
  title,
  checkedAt: DOCS_CHECKED_AT,
  finding,
});

const API_OVERVIEW = (finding: string) =>
  doc('43716366/API+Web+Services', 'API Web Services', finding);
const REST = (finding: string) => doc('43715778/REST+Interface', 'REST Interface', finding);
const RULES = (finding: string) => doc('43714473/Rules', 'Rules', finding);

const CURRENT_DOCS =
  'Agiloft CLM, current documentation as of 2026-10-16; cloud-hosted and self-hosted KBs unless noted.';
const REST_GROUP =
  'Integration user must belong to a REST-enabled group; table/field access follows that user’s group permissions.';

const NO_ADMIN_API_FINDING =
  'The API Web Services, REST Interface and OpenAPI Interface pages list record, attachment, lock, metadata, saved-search, action-button, hotlink and webhook operations only. No operation for creating or modifying this configuration is documented; the documented method is the Setup wizards in the Agiloft UI.';

const adminUnsupported = (
  id: string,
  title: string,
  description: string,
  manualAlternative: string,
  extraEvidence: Evidence[] = [],
): CapabilityDefinition => ({
  id,
  title,
  description,
  category: 'administration',
  docStatus: 'unsupported',
  productUse: 'not_available',
  evidence: [REST(NO_ADMIN_API_FINDING), ...extraEvidence],
  appliesTo: CURRENT_DOCS,
  requiredPermissions: ['Agiloft administrator (admin group) in the Agiloft UI'],
  mechanism: null,
  limits: [
    'No external callable API found in official documentation. Not attempted through undocumented endpoints, database access or browser automation.',
  ],
  manualAlternative,
  instanceProbe: 'none',
});

export const CAPABILITIES: readonly CapabilityDefinition[] = [
  // ---------------------------------------------------------------- licensing
  {
    id: 'licensing.api_access',
    title: 'API access licensing',
    description: 'Whether the KB edition includes API web services.',
    category: 'licensing',
    docStatus: 'verified',
    productUse: 'used',
    evidence: [
      API_OVERVIEW(
        'API services are available with the Platform edition of Agiloft CLM; on older editions they require an Advanced or Premium edition.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [],
    mechanism: null,
    limits: [
      'Edition is not reported by any documented API; confirm with your Agiloft administrator.',
    ],
    instanceProbe: 'read_only_probe',
  },
  // --------------------------------------------------------------- interfaces
  {
    id: 'interface.rest',
    title: 'REST interface (/ewws)',
    description: 'Record, metadata, lock and attachment operations over HTTPS.',
    category: 'interface',
    docStatus: 'verified',
    productUse: 'used',
    evidence: [
      REST(
        'Operations are exposed under /ewws/{operation} with $KB, $table and $lang parameters; a /.json decorator returns JSON.',
      ),
      API_OVERVIEW(
        'REST services are enabled by default but restricted by group permissions and license types.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP],
    mechanism: 'HTTPS GET/POST /ewws/EW{Operation}/.json',
    limits: [
      'A delay (default one second, global variable WSDelay) is inserted after every REST call.',
      'Not recommended for bulk synchronisation; Agiloft recommends import or other integration methods for bulk work.',
    ],
    instanceProbe: 'read_only_probe',
  },
  {
    id: 'interface.openapi',
    title: 'OpenAPI / Swagger documentation',
    description: 'Per-KB generated OpenAPI specification covering the KB’s tables and fields.',
    category: 'interface',
    docStatus: 'verified',
    productUse: 'not_implemented',
    evidence: [
      doc(
        '929595396/OpenAPI+Interface',
        'OpenAPI Interface',
        'Swagger UI is available in the KB at Setup > System > View REST documentation, with a downloadable OpenAPI JSON file. The page states there are currently no rate limits per user, token or KB.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: ['Agiloft administrator to open Setup > System'],
    mechanism: 'Swagger UI inside the KB; JSON download',
    limits: [
      'The OpenAPI document URL is not published in the documentation, so Agiloft Control does not fetch it automatically.',
    ],
    instanceProbe: 'none',
  },
  {
    id: 'interface.soap',
    title: 'SOAP web services',
    description: 'Legacy SOAP interface.',
    category: 'interface',
    docStatus: 'verified',
    productUse: 'blocked_by_policy',
    evidence: [
      API_OVERVIEW(
        'SOAP services are disabled by default and are not recommended for new integrations.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [],
    mechanism: null,
    limits: ['Not used: OpenAPI/REST are the documented recommendation.'],
    instanceProbe: 'none',
  },
  // ----------------------------------------------------------- authentication
  {
    id: 'auth.password_jwt',
    title: 'Login token (EWLogin JWT)',
    description: 'Exchange integration-user credentials for a short-lived bearer token.',
    category: 'authentication',
    docStatus: 'verified',
    productUse: 'used',
    evidence: [
      doc(
        '43714204/REST+-+Login',
        'REST - Login',
        'POST /ewws/EWLogin with $KB, $login, $password, $lang returns access_token, refresh_token, expires_in and authentication_scheme (Bearer). Default expiry 15 minutes; EWLogout ends the session.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP],
    mechanism: 'POST /ewws/EWLogin (credentials sent in the form body, never the URL)',
    limits: ['Token lifetime defaults to 15 minutes (global variable token_expires_in, up to 60).'],
    instanceProbe: 'read_only_probe',
  },
  {
    id: 'auth.oauth2_client_credentials',
    title: 'OAuth 2.0 client credentials',
    description: 'Machine-to-machine token for a service account configured in the KB.',
    category: 'authentication',
    docStatus: 'verified',
    productUse: 'used',
    evidence: [
      doc(
        '43716464/Use+OAuth2+to+Access+REST+API',
        'Use OAuth2 to Access REST API',
        'Client credentials flow: POST /ewws/otoken with grant_type=client_credentials, client_id, client_secret (application/x-www-form-urlencoded). Clients are configured at Setup > Integration > OAuth2 Client Setup and bound to a Contact ID whose permissions apply.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: ['OAuth2 client configured and enabled by an Agiloft administrator'],
    mechanism: 'POST /ewws/otoken',
    limits: [
      'Token expiry configurable 1–60 minutes (default 15).',
      'All calls run as the associated contact: a shared integration identity.',
    ],
    instanceProbe: 'read_only_probe',
  },
  {
    id: 'auth.oauth2_authorization_code',
    title: 'OAuth 2.0 authorization code (+PKCE)',
    description: 'User-centric OAuth flow that could let actions run under an individual identity.',
    category: 'authentication',
    docStatus: 'verified',
    productUse: 'not_implemented',
    evidence: [
      doc(
        '43716464/Use+OAuth2+to+Access+REST+API',
        'Use OAuth2 to Access REST API',
        'Authorization Code (with PKCE) is supported via /ewws/oauth; scope is permissions_for:CONTACT_ID as defined in the client configuration; refresh tokens expire after 28 days of inactivity.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: ['OAuth2 client configured by an Agiloft administrator'],
    mechanism: '/ewws/oauth then /ewws/otoken',
    limits: [
      'The documented scope binds permissions to the Contact ID in the client configuration, so this flow does not by itself give per-user identity. Planned for evaluation (see roadmap).',
    ],
    instanceProbe: 'none',
  },
  {
    id: 'auth.url_credentials',
    title: 'Credentials in request parameters',
    description: '$login/$password on each request.',
    category: 'authentication',
    docStatus: 'verified',
    productUse: 'blocked_by_policy',
    evidence: [
      REST('Each operation accepts $login and $password parameters; POST bodies can conceal them.'),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [],
    mechanism: null,
    limits: [
      'Never used: credentials would appear in URLs and logs. Agiloft Control always uses a token.',
    ],
    instanceProbe: 'none',
  },
  // ------------------------------------------------------------------- schema
  {
    id: 'schema.tables_fields',
    title: 'Table and field metadata (EWTable)',
    description:
      'List tables with label and logical name; list fields with name, label, type and required flag.',
    category: 'schema',
    docStatus: 'verified',
    productUse: 'used',
    evidence: [
      doc(
        '43715609/REST+-+Table',
        'REST - Table',
        'EWTable returns tables (label, logicalName) and fields (name, label, type, required flag). Parameters: table, includelinkedinfo, skipColumnsInfo. Action buttons, related tables, embedded search results and embedded communications are not supported. Requires EWLogin or OAuth 2.0.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP],
    mechanism: 'GET /ewws/EWTable/.json?$KB=..&table=..&includelinkedinfo=true',
    limits: [
      'Related tables, action buttons, embedded searches and embedded communications are not returned.',
      'The JSON key of the required flag is not shown in the documentation example; when absent, Agiloft Control reports "required: unknown".',
      'Reading metadata does not imply permission to change schema.',
    ],
    instanceProbe: 'read_only_probe',
  },
  {
    id: 'schema.linked_fields',
    title: 'Linked-field relationships',
    description: 'Source table and column for linked fields.',
    category: 'schema',
    docStatus: 'verified',
    productUse: 'used',
    evidence: [
      doc(
        '43715609/REST+-+Table',
        'REST - Table',
        'With includelinkedinfo=true, linked fields return isLinked and linkedInfo (linkedTable, linkedColumn).',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP],
    mechanism: 'EWTable includelinkedinfo=true',
    limits: ['Linked fields return only source table information.'],
    instanceProbe: 'read_only_probe',
  },
  // ------------------------------------------------------------------ records
  {
    id: 'records.search',
    title: 'Search records (EWSearch)',
    description: 'Ad hoc queries with field selection and pagination.',
    category: 'records',
    docStatus: 'verified',
    productUse: 'used',
    evidence: [
      doc(
        '43717730/REST+-+Search',
        'REST - Search',
        'Operators =, !=, ~= (contains), <, <=, >, >=, && and ||; values in single quotes; null for empty. Pagination with page (from 0) and limit; limit 0 returns all records. The REST interface creates a new session per call, so the query is rebuilt and re-run each time.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP],
    mechanism: 'GET /ewws/EWSearch/.json?query=..&field=..&page=..&limit=..',
    limits: [
      'Pages may shift or show gaps between calls because each REST call re-runs the query.',
      'No escape for single quotes inside values is documented; such values are rejected rather than guessed.',
      'Agiloft Control caps limit at 100 and never sends limit=0.',
    ],
    instanceProbe: 'read_only_probe',
  },
  {
    id: 'records.read',
    title: 'Read record (EWRead)',
    description: 'Retrieve a record by ID.',
    category: 'records',
    docStatus: 'verified',
    productUse: 'used',
    evidence: [
      doc(
        '43714567/REST+-+Read',
        'REST - Read',
        'EWRead returns the encoded data of the record identified by id (or a $searchSQL that matches exactly one record).',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP],
    mechanism: 'GET /ewws/EWRead/.json?id=..',
    limits: ['Agiloft Control only addresses records by numeric ID; $searchSQL is not exposed.'],
    instanceProbe: 'read_only_probe',
  },
  {
    id: 'records.create',
    title: 'Create record (EWCreate)',
    description: 'Create a record with field values.',
    category: 'records',
    docStatus: 'verified',
    productUse: 'used',
    evidence: [
      doc(
        '43714571/REST+-+Create',
        'REST - Create',
        'EWCreate creates a record in the specified KB and table and returns the new record ID. Content-Type application/x-www-form-urlencoded.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP, 'Create permission on the target table'],
    mechanism: 'POST /ewws/EWCreate/.json',
    limits: [
      'No idempotency key is documented. A create whose response is lost cannot be safely retried unless a unique field allows reconciliation.',
    ],
    instanceProbe: 'requires_sandbox_write',
  },
  {
    id: 'records.update',
    title: 'Update record (EWUpdate)',
    description: 'Update fields on an existing record.',
    category: 'records',
    docStatus: 'verified',
    productUse: 'used',
    evidence: [
      doc(
        '43714575/REST+-+Update',
        'REST - Update',
        'EWUpdate updates the specified record and returns its final contents. $operationHints=NOLOCK forces an update of a locked record.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP, 'Edit permission on the target table and fields'],
    mechanism: 'POST /ewws/EWUpdate/.json',
    limits: [
      'Agiloft Control never sends $operationHints=NOLOCK.',
      'No conditional (compare-and-set) update is documented.',
    ],
    instanceProbe: 'requires_sandbox_write',
  },
  {
    id: 'records.optimistic_concurrency',
    title: 'Optimistic concurrency control',
    description: 'Conditional update that fails if the record changed since it was read.',
    category: 'records',
    docStatus: 'unsupported',
    productUse: 'not_available',
    evidence: [
      doc(
        '43714575/REST+-+Update',
        'REST - Update',
        'No version, ETag or conditional update parameter is documented for EWUpdate.',
      ),
      doc(
        '43714340/REST+-+Lock',
        'REST - Lock',
        'EWLock can check (GET), lock (PUT) and unlock (DELETE) a record; responses include lock_status, locked_by and lock_expires_in_minutes.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP],
    mechanism:
      'Substitute: freshness check (re-read and compare captured values) immediately before each update, plus an EWLock record lock held for the duration of the write.',
    limits: [
      'A small race window remains between the freshness read and the update if another client ignores record locks.',
    ],
    instanceProbe: 'none',
  },
  {
    id: 'records.lock',
    title: 'Record lock (EWLock)',
    description: 'Check, acquire and release a record lock.',
    category: 'records',
    docStatus: 'verified',
    productUse: 'used',
    evidence: [
      doc(
        '43714340/REST+-+Lock',
        'REST - Lock',
        'GET checks, PUT locks and DELETE unlocks a record. force allows admins to unlock a record locked by another user.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP],
    mechanism: 'GET/PUT/DELETE /ewws/EWLock/.json?$table=..&id=..',
    limits: ['Agiloft Control never uses force.'],
    instanceProbe: 'read_only_probe',
  },
  {
    id: 'records.link_by_value',
    title: 'Set linked fields by value (Query By Example)',
    description: 'Link a record to another by the value of an imported column.',
    category: 'records',
    docStatus: 'verified',
    productUse: 'used',
    evidence: [
      REST(
        'Linked fields are set using Query By Example: field=:value or field=Table:value; ":" and "?" in values must be escaped with a backslash.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP],
    mechanism: 'field=:value in EWCreate/EWUpdate',
    limits: [
      'If more than one record matches, Agiloft rejects the write. The "?" SQL form is not used.',
    ],
    instanceProbe: 'requires_sandbox_write',
  },
  {
    id: 'records.rules_triggered_by_api',
    title: 'Business rules run on API writes',
    description: 'Whether event rules fire when records change through web services.',
    category: 'automation',
    docStatus: 'verified',
    productUse: 'used',
    evidence: [
      RULES(
        'Event-specific rules can be limited by "Only when the change occurs by means of" Email, Web or API. "Web" also covers changes made by a Web Service call; "API" refers to internal Agiloft APIs (rules and actions), not external web APIs.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [],
    mechanism: 'Native Agiloft behaviour',
    limits: [
      'Any create or update may trigger rules configured for "Web" changes, including emails, field updates, record creation and deletion. These effects cannot be enumerated through any documented API and may not be reversible.',
    ],
    instanceProbe: 'none',
  },
  {
    id: 'records.delete',
    title: 'Delete record (EWDelete)',
    description: 'Permanently delete a record.',
    category: 'records',
    docStatus: 'verified',
    productUse: 'blocked_by_policy',
    evidence: [REST('EWDelete (GET/POST/DELETE) deletes a record and returns nothing.')],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP, 'Delete permission'],
    mechanism: null,
    limits: ['Not exposed by default: destructive and irreversible.'],
    instanceProbe: 'none',
  },
  {
    id: 'records.select_sql',
    title: 'SQL select (EWSelect) and $searchSQL',
    description: 'Limited SQL selection.',
    category: 'records',
    docStatus: 'verified',
    productUse: 'blocked_by_policy',
    evidence: [
      REST('EWSelect supports limited SQL select functionality and returns record identifiers.'),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP],
    mechanism: null,
    limits: ['Not exposed: raw SQL fragments are not accepted from callers.'],
    instanceProbe: 'none',
  },
  {
    id: 'records.upsert',
    title: 'Upsert (EWUpsert)',
    description: 'Create or update depending on a match.',
    category: 'records',
    docStatus: 'verified',
    productUse: 'not_implemented',
    evidence: [REST('EWUpsert (POST) creates a new record or updates an existing record.')],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP],
    mechanism: null,
    limits: [
      'Not used: plans state explicitly whether they create or update so reviewers see exact effects.',
    ],
    instanceProbe: 'none',
  },
  {
    id: 'records.async_decorator',
    title: 'Asynchronous ("fire-and-forget") writes',
    description: '/ewws/async/ decorator for create, update and delete.',
    category: 'records',
    docStatus: 'verified',
    productUse: 'blocked_by_policy',
    evidence: [
      REST(
        'The asynchronous decorator applies to EWCreate, EWUpdate and EWDelete; EWAsyncStatus checks status.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP],
    mechanism: null,
    limits: ['Not used: per-operation results are required for audit and reconciliation.'],
    instanceProbe: 'none',
  },
  // -------------------------------------------------------------- attachments
  {
    id: 'attachments.read',
    title: 'Attachment info and retrieval',
    description: 'EWAttachInfo and EWRetrieve.',
    category: 'attachments',
    docStatus: 'verified',
    productUse: 'not_implemented',
    evidence: [
      REST(
        'EWAttachInfo returns information about a record’s attachments; EWRetrieve retrieves an attachment.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP],
    mechanism: null,
    limits: [
      'Planned for phase 2 with content-type allow-listing, size limits and untrusted-content framing.',
    ],
    instanceProbe: 'none',
  },
  {
    id: 'attachments.write',
    title: 'Add or remove attachments',
    description: 'EWAttach (PUT) and EWRemoveAttachment.',
    category: 'attachments',
    docStatus: 'verified',
    productUse: 'not_implemented',
    evidence: [
      REST(
        'EWAttach (PUT) adds an attachment; EWRemoveAttachment removes one; multipart/form-data accepted on file fields.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP],
    mechanism: null,
    limits: ['Not implemented in this release.'],
    instanceProbe: 'none',
  },
  // --------------------------------------------------------------- automation
  {
    id: 'automation.action_button',
    title: 'Run action button (EWActionButton)',
    description: 'Run a configured action button on a record.',
    category: 'automation',
    docStatus: 'verified',
    productUse: 'blocked_by_policy',
    evidence: [REST('EWActionButton (POST) runs an action button from a specified record.')],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: [REST_GROUP],
    mechanism: null,
    limits: [
      'Blocked by default: the effects of an action button cannot be inspected through a documented API.',
    ],
    instanceProbe: 'none',
  },
  {
    id: 'automation.webhooks',
    title: 'Outbound webhooks',
    description: 'Register HTTPS callbacks for create/update/delete events.',
    category: 'automation',
    docStatus: 'verified',
    productUse: 'not_implemented',
    evidence: [
      doc(
        '43714342/Webhooks',
        'Webhooks',
        'Webhooks can be registered with POST /ewws/webhooks or in Setup > Integration > Webhooks Setup. Agiloft POSTs to a public HTTPS URL and retries up to five times.',
      ),
    ],
    appliesTo: CURRENT_DOCS,
    requiredPermissions: ['Webhooks Setup deployed in the KB'],
    mechanism: null,
    limits: [
      'Relevant only to the "external orchestration" route, which requires a publicly reachable receiver.',
    ],
    instanceProbe: 'none',
  },
  {
    id: 'automation.workflow_records',
    title: 'Workflow/approval/task templates as records',
    description:
      'Some KBs store workflow, approval or task templates in ordinary tables that are editable through record APIs.',
    category: 'automation',
    docStatus: 'unverified',
    productUse: 'used',
    evidence: [
      RULES(
        'Example rule: "When a user selects a workflow in a Service Request, automatically create Task records linked to that workflow." Whether such templates exist is KB-specific.',
      ),
    ],
    appliesTo: 'KB-specific. Detected through schema discovery on each connection.',
    requiredPermissions: [REST_GROUP],
    mechanism: 'Record create/update on detected template tables',
    limits: [
      'Only treated as available when schema discovery finds the relevant tables on the connected KB.',
    ],
    instanceProbe: 'schema_detection',
  },
  // ---------------------------------------------------------- administration
  adminUnsupported(
    'admin.tables',
    'Create or modify tables',
    'Programmatic table creation or changes.',
    'Setup > Tables, then New or Edit (Table wizard).',
  ),
  adminUnsupported(
    'admin.fields',
    'Create or modify fields',
    'Programmatic field creation or changes.',
    'Field wizard in the table setup screens (menu path not verified by Agiloft Control; see the Agiloft Administrator Guide).',
  ),
  adminUnsupported(
    'admin.rules',
    'Create, read or modify rules',
    'Programmatic access to business rules.',
    'Setup > Rules or Setup [Table] > Rules tab (Rules wizard: General, Rule Type, Condition, Schedule, Action tabs).',
    [
      RULES(
        'Rules are created and edited with the Rules wizard (Setup [Table] > Rules, or Setup > Rules).',
      ),
    ],
  ),
  adminUnsupported(
    'admin.actions',
    'Create or modify actions',
    'Email, update-fields, validate, linked-record and other actions.',
    'Action tab of the Rules wizard (Setup [Table] > Rules).',
  ),
  adminUnsupported(
    'admin.layouts',
    'Modify layouts',
    'Form and list layouts.',
    'Layout configuration in the table setup screens (menu path not verified by Agiloft Control; see the Agiloft Administrator Guide).',
  ),
  adminUnsupported(
    'admin.permissions',
    'Modify groups and permissions',
    'Group, table and field permissions.',
    'Group and permission configuration in Setup (menu path not verified by Agiloft Control; see the Agiloft Administrator Guide).',
  ),
  adminUnsupported(
    'admin.workflows',
    'Modify workflow state machines',
    'Workflow states and transitions.',
    'Workflow configuration in the table setup screens (menu path not verified by Agiloft Control; see the Agiloft Administrator Guide).',
  ),
  adminUnsupported(
    'admin.oauth_clients',
    'Manage OAuth clients',
    'Creating OAuth2 client registrations.',
    'Setup > Integration > OAuth2 Client Setup.',
    [
      doc(
        '43716464/Use+OAuth2+to+Access+REST+API',
        'Use OAuth2 to Access REST API',
        'OAuth clients are configured in Setup > Integration > OAuth2 Client Setup.',
      ),
    ],
  ),
];

export const CAPABILITY_IDS = new Set(CAPABILITIES.map((c) => c.id));

export function getCapability(id: string): CapabilityDefinition | undefined {
  return CAPABILITIES.find((c) => c.id === id);
}
