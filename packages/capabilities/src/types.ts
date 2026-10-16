export type DocStatus = 'verified' | 'unverified' | 'unsupported' | 'restricted';
export type InstanceStatus = DocStatus | 'not_checked';

/**
 * How Agiloft Control itself treats the capability:
 *  - used: implemented and available subject to policy
 *  - not_implemented: documented but not yet built (see roadmap)
 *  - blocked_by_policy: documented but deliberately not exposed (e.g. delete, raw SQL)
 *  - not_available: nothing callable exists; a manual plan is produced instead
 */
export type ProductUse = 'used' | 'not_implemented' | 'blocked_by_policy' | 'not_available';

export type CapabilityCategory =
  | 'interface'
  | 'authentication'
  | 'schema'
  | 'records'
  | 'attachments'
  | 'automation'
  | 'administration'
  | 'licensing';

export interface Evidence {
  url: string;
  title: string;
  checkedAt: string;
  /** Short paraphrase or quotation of what the source says. */
  finding: string;
}

export interface CapabilityDefinition {
  id: string;
  title: string;
  description: string;
  category: CapabilityCategory;
  docStatus: DocStatus;
  productUse: ProductUse;
  evidence: Evidence[];
  appliesTo: string;
  requiredPermissions: string[];
  mechanism: string | null;
  limits: string[];
  /** When the capability is unavailable: what an administrator does instead. */
  manualAlternative?: string;
  /** Whether a read-only probe can confirm this against a connected instance. */
  instanceProbe: 'read_only_probe' | 'schema_detection' | 'requires_sandbox_write' | 'none';
}

export interface InstanceCapabilityResult {
  capabilityId: string;
  status: InstanceStatus;
  checkedAt: string | null;
  detail: string;
  /** true for results produced by the demo adapter; these never describe a real instance. */
  synthetic: boolean;
}
