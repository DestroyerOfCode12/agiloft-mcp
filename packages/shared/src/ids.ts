import { randomUUID } from 'node:crypto';

export type IdPrefix =
  'conn' | 'plan' | 'apr' | 'exe' | 'op' | 'aud' | 'usr' | 'ses' | 'scn' | 'ver';

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}
