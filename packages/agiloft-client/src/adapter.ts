import type { AgiloftRecord, FieldValue, TableSchema, TableSummary } from '@agiloft-control/shared';
import type { InstanceCapabilityResult } from '@agiloft-control/capabilities';

export interface AdapterIdentity {
  kind: 'live' | 'demo';
  kbName: string;
  instanceLabel: string;
  /** Redacted base URL for display; null for the demo adapter. */
  baseUrl: string | null;
}

export interface SearchParams {
  table: string;
  /** A query string produced by `buildQuery`; never caller-supplied text. */
  query: string;
  fields: string[];
  page: number;
  limit: number;
}

export interface SearchResult {
  records: AgiloftRecord[];
  /** null when the instance did not report a total. */
  total: number | null;
}

export interface LockStatus {
  status: 'NO_LOCK' | 'LOCKED' | 'UNKNOWN';
  lockedBy?: string;
  expiresInMinutes?: number;
}

export interface VerificationReport {
  checkedAt: string;
  identity: AdapterIdentity;
  ok: boolean;
  summary: string;
  latencyMs: number;
  tablesVisible: number | null;
  results: InstanceCapabilityResult[];
}

export type WriteValues = Record<string, FieldValue>;

/**
 * The single boundary between Agiloft Control and Agiloft. Live and demo
 * implementations are interchangeable; everything above this interface
 * (policy, approvals, execution) is identical in both modes.
 */
export interface AgiloftAdapter {
  readonly identity: AdapterIdentity;
  verify(): Promise<VerificationReport>;
  listTables(): Promise<TableSummary[]>;
  describeTable(table: string): Promise<TableSchema>;
  search(params: SearchParams): Promise<SearchResult>;
  read(table: string, id: string, fields?: string[]): Promise<AgiloftRecord>;
  create(table: string, values: WriteValues): Promise<{ id: string }>;
  update(table: string, id: string, values: WriteValues): Promise<AgiloftRecord>;
  lockStatus(table: string, id: string): Promise<LockStatus>;
  lock(table: string, id: string): Promise<LockStatus>;
  unlock(table: string, id: string): Promise<LockStatus>;
  close(): Promise<void>;
}

/** Field that Agiloft maintains with the last modification time. */
export const DATE_UPDATED_FIELD = 'date_updated';
