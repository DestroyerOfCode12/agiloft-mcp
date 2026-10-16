import { CAPABILITIES, getCapability } from './registry.ts';
import type { CapabilityDefinition, InstanceCapabilityResult, InstanceStatus } from './types.ts';

export interface CapabilityDecision {
  capabilityId: string;
  allowed: boolean;
  reason: string;
  definition: CapabilityDefinition | undefined;
  instanceStatus: InstanceStatus;
}

/**
 * Decides whether Agiloft Control may use a capability on a given connection.
 * A capability must be documented, implemented, and not contradicted by the
 * instance. Writes cannot be probed read-only, so "not_checked" is tolerated
 * for them but surfaced as a warning in plan review.
 */
export function decideCapability(
  capabilityId: string,
  instance: readonly InstanceCapabilityResult[] = [],
): CapabilityDecision {
  const definition = getCapability(capabilityId);
  const instanceResult = instance.find((r) => r.capabilityId === capabilityId);
  const instanceStatus: InstanceStatus = instanceResult?.status ?? 'not_checked';
  const base = { capabilityId, definition, instanceStatus };

  if (!definition) {
    return {
      ...base,
      allowed: false,
      reason: `Unknown capability "${capabilityId}". Nothing is executed for unregistered capabilities.`,
    };
  }
  if (definition.docStatus !== 'verified') {
    return {
      ...base,
      allowed: false,
      reason: `${definition.title} is ${definition.docStatus} in official documentation.${definition.manualAlternative ? ` Manual route: ${definition.manualAlternative}` : ''}`,
    };
  }
  if (definition.productUse === 'blocked_by_policy') {
    return {
      ...base,
      allowed: false,
      reason:
        `${definition.title} is documented but disabled by Agiloft Control policy. ${definition.limits[0] ?? ''}`.trim(),
    };
  }
  if (definition.productUse !== 'used') {
    return {
      ...base,
      allowed: false,
      reason: `${definition.title} is documented but not implemented in this release.`,
    };
  }
  if (instanceStatus === 'unsupported' || instanceStatus === 'restricted') {
    return {
      ...base,
      allowed: false,
      reason: `${definition.title} was reported as ${instanceStatus} on this connection: ${instanceResult?.detail ?? 'no detail'}.`,
    };
  }
  return {
    ...base,
    allowed: true,
    reason:
      instanceStatus === 'verified'
        ? 'Verified in documentation and on this connection.'
        : 'Verified in documentation; not yet confirmed on this connection.',
  };
}

export function summariseCapabilities(instance: readonly InstanceCapabilityResult[] = []) {
  const counts = { verified: 0, unverified: 0, unsupported: 0, restricted: 0 };
  for (const c of CAPABILITIES) counts[c.docStatus] += 1;
  const instanceCounts = {
    verified: 0,
    unverified: 0,
    unsupported: 0,
    restricted: 0,
    not_checked: 0,
  };
  for (const c of CAPABILITIES) {
    const r = instance.find((i) => i.capabilityId === c.id);
    instanceCounts[r?.status ?? 'not_checked'] += 1;
  }
  return { total: CAPABILITIES.length, documentation: counts, instance: instanceCounts };
}
