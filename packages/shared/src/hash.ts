import { createHash } from 'node:crypto';

/** Deterministic JSON: object keys sorted recursively, undefined dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) sorted[key] = sortValue(v);
    }
    return sorted;
  }
  return value;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function hashObject(value: unknown): string {
  return sha256(canonicalJson(value));
}
