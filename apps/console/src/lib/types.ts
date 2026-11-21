import type {
  ChangePlanDocument,
  Environment,
  ExecutionStatus,
  OperationStatus,
  PlanStatus,
  RoleAssignment,
  TableSchema,
  Relationship,
  AgiloftRecord,
  ScenarioStep,
  Unknown,
  ValidationIssue,
} from '@agiloft-control/shared';
import type { CapabilityDefinition, InstanceCapabilityResult } from '@agiloft-control/capabilities';

export type {
  ChangePlanDocument,
  Environment,
  ExecutionStatus,
  OperationStatus,
  PlanStatus,
  TableSchema,
  Relationship,
  AgiloftRecord,
  ScenarioStep,
  Unknown,
  ValidationIssue,
  CapabilityDefinition,
  InstanceCapabilityResult,
};

export interface Me {
  userId: string;
  email: string;
  displayName: string;
  roles: RoleAssignment[];
  permissions: Record<Environment, string[]>;
}
export interface Session {
  authenticated: boolean;
  csrfToken?: string;
  user?: Me;
}
export interface VerificationReport {
  checkedAt: string;
  ok: boolean;
  summary: string;
  latencyMs: number;
  tablesVisible: number | null;
  results: InstanceCapabilityResult[];
  identity: {
    kind: 'live' | 'demo';
    kbName: string;
    instanceLabel: string;
    baseUrl: string | null;
  };
}
export interface Connection {
  id: string;
  name: string;
  environment: Environment;
  mode: 'demo' | 'live';
  baseUrl: string | null;
  kbName: string;
  lang: string;
  authMethod: string;
  principalHint: string | null;
  credentialsStored: boolean;
  identityNote: string;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastVerification: VerificationReport | null;
}
export interface PlanSummary {
  id: string;
  title: string;
  status: PlanStatus;
  environment: Environment;
  connectionId: string;
  version: number;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  operationCount: number;
  writeCount: number;
  manualCount: number;
}
export type PlanDetail = ChangePlanDocument & {
  createdByName: string | null;
  approvalDecidedByName: string | null;
  versions: { version: number; hash: string; createdBy: string; createdAt: string }[];
};
export interface ExecutionOp {
  operationId: string;
  seq: number;
  kind: string;
  title: string;
  status: OperationStatus;
  attempts: number;
  recordId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: Record<string, unknown> | null;
  error: { code?: string; message?: string } | null;
}
export interface Execution {
  id: string;
  planId: string;
  planVersion: number;
  planHash: string;
  planTitle: string;
  connectionId: string;
  environment: Environment;
  status: ExecutionStatus;
  requestedByName: string | null;
  requestedVia: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequested: boolean;
  runCount: number;
  summary: (Record<string, number | string> & { guidance?: string }) | null;
  operations: ExecutionOp[];
  events: {
    id: number;
    at: string;
    level: 'info' | 'warn' | 'error';
    operationId: string | null;
    message: string;
  }[];
}
export interface ExecutionSummary {
  id: string;
  planId: string;
  planVersion: number;
  planTitle: string;
  status: ExecutionStatus;
  environment: Environment;
  requestedVia: string;
  requestedByName: string | null;
  createdAt: string;
  finishedAt: string | null;
  operations: { total: number; succeeded: number; failed: number; manual: number };
}
export interface CapabilityRow extends CapabilityDefinition {
  instance: InstanceCapabilityResult | null;
}
export interface CapabilitySummary {
  total: number;
  documentation: Record<'verified' | 'unverified' | 'unsupported' | 'restricted', number>;
  instance: Record<
    'verified' | 'unverified' | 'unsupported' | 'restricted' | 'not_checked',
    number
  >;
}
export interface Overview {
  connections: {
    id: string;
    name: string;
    environment: Environment;
    mode: string;
    ok: boolean | null;
    checkedAt: string | null;
    summary: string;
  }[];
  capabilitySummary: CapabilitySummary;
  capabilityConnection: { id: string; name: string; mode: string } | null;
  pendingApprovals: PlanSummary[];
  pendingApprovalCount: number;
  recentExecutions: ExecutionSummary[];
  recentFailures: ExecutionSummary[];
  planCounts: Record<string, number>;
  dataSource: string;
}
export interface SearchResult {
  table: string;
  records: AgiloftRecord[];
  total: number | null;
  page: number;
  pageSize: number;
  hasMore: boolean | null;
  query: string;
  fields: string[];
  notes: string[];
}
export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  via: string;
  action: string;
  environment: string | null;
  targetType: string | null;
  targetId: string | null;
  result: 'success' | 'denied' | 'failure';
  correlationId: string | null;
  details: Record<string, unknown> | null;
}
export interface Policy {
  environment: Environment;
  writesEnabled: boolean;
  requireSeparationOfDuties: boolean;
  approvalTtlMinutes: number;
  allowedWriteTables: string[] | null;
  useRecordLocks: boolean;
  updatedAt: string;
}
