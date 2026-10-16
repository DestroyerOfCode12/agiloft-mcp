import type { ColumnType, Generated, JSONColumnType } from 'kysely';

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Json<T extends object | null = Record<string, unknown>> = JSONColumnType<T, string, string>;

export interface UsersTable {
  id: string;
  email: string;
  display_name: string;
  external_subject: string | null;
  disabled: Generated<boolean>;
  created_at: GeneratedTimestamp;
}

export interface RoleAssignmentsTable {
  id: Generated<number>;
  user_id: string;
  role: string;
  environment: string;
  created_at: GeneratedTimestamp;
}

export interface SessionsTable {
  id: string; // sha256 of the session token
  user_id: string;
  csrf_token: string;
  created_at: GeneratedTimestamp;
  expires_at: Timestamp;
  last_seen_at: GeneratedTimestamp;
}

export interface ConnectionsTable {
  id: string;
  name: string;
  environment: string;
  mode: 'demo' | 'live';
  base_url: string | null;
  kb_name: string;
  lang: string;
  auth_method: 'none' | 'password_jwt' | 'oauth_client_credentials';
  secret_ciphertext: string | null;
  principal_hint: string | null;
  disabled: Generated<boolean>;
  created_by: string;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  last_verification: Json | null;
  last_verified_at: Timestamp | null;
}

export interface EnvironmentPoliciesTable {
  environment: string;
  writes_enabled: boolean;
  require_separation_of_duties: boolean;
  approval_ttl_minutes: number;
  allowed_write_tables: Json<string[] | null> | null;
  use_record_locks: boolean;
  updated_by: string | null;
  updated_at: GeneratedTimestamp;
}

export interface PlansTable {
  id: string;
  connection_id: string;
  environment: string;
  title: string;
  status: string;
  current_version: number;
  created_by: string;
  submitted_by: string | null;
  submitted_at: Timestamp | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface PlanVersionsTable {
  plan_id: string;
  version: number;
  content: Json;
  hash: string;
  created_by: string;
  created_at: GeneratedTimestamp;
  validation: Json | null;
  validated_at: Timestamp | null;
}

export interface ApprovalsTable {
  id: string;
  plan_id: string;
  plan_version: number;
  plan_hash: string;
  connection_id: string;
  environment: string;
  decision: 'approved' | 'rejected';
  reason: string;
  decided_by: string;
  decided_at: GeneratedTimestamp;
  expires_at: Timestamp | null;
  invalidated_at: Timestamp | null;
  invalidated_reason: string | null;
}

export interface ExecutionsTable {
  id: string;
  plan_id: string;
  plan_version: number;
  plan_hash: string;
  approval_id: string;
  connection_id: string;
  environment: string;
  status: string;
  requested_by: string;
  requested_via: string;
  created_at: GeneratedTimestamp;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
  cancel_requested: Generated<boolean>;
  cancel_requested_by: string | null;
  lease_owner: string | null;
  lease_expires_at: Timestamp | null;
  run_count: Generated<number>;
  summary: Json | null;
}

export interface ExecutionOperationsTable {
  execution_id: string;
  operation_id: string;
  seq: number;
  kind: string;
  title: string;
  status: string;
  attempts: Generated<number>;
  record_id: string | null;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
  result: Json | null;
  error: Json | null;
}

export interface ExecutionEventsTable {
  id: Generated<number>;
  execution_id: string;
  at: GeneratedTimestamp;
  level: 'info' | 'warn' | 'error';
  operation_id: string | null;
  message: string;
  data: Json | null;
}

export interface AuditEventsTable {
  id: string;
  at: GeneratedTimestamp;
  actor_id: string | null;
  actor_label: string;
  actor_type: 'user' | 'system';
  via: 'console' | 'mcp' | 'worker' | 'system';
  action: string;
  environment: string | null;
  connection_id: string | null;
  target_type: string | null;
  target_id: string | null;
  result: 'success' | 'denied' | 'failure';
  correlation_id: string | null;
  details: Json | null;
}

export interface DemoRecordsTable {
  connection_id: string;
  table_name: string;
  record_id: string;
  data: Json<Record<string, unknown>>;
}

export interface DemoFaultsTable {
  id: string;
  connection_id: string;
  kind: string;
  table_name: string | null;
  operation: string | null;
  created_at: GeneratedTimestamp;
}

export interface SettingsTable {
  key: string;
  value: Json;
  updated_at: GeneratedTimestamp;
}

export interface Database {
  users: UsersTable;
  role_assignments: RoleAssignmentsTable;
  sessions: SessionsTable;
  connections: ConnectionsTable;
  environment_policies: EnvironmentPoliciesTable;
  plans: PlansTable;
  plan_versions: PlanVersionsTable;
  approvals: ApprovalsTable;
  executions: ExecutionsTable;
  execution_operations: ExecutionOperationsTable;
  execution_events: ExecutionEventsTable;
  audit_events: AuditEventsTable;
  demo_records: DemoRecordsTable;
  demo_faults: DemoFaultsTable;
  settings: SettingsTable;
}
