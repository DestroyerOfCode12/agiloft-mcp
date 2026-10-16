import type { Operation } from '@agiloft-control/shared';

export interface OrderResult {
  order: string[];
  errors: { code: string; message: string; operationId?: string }[];
}

/**
 * Deterministic topological order (Kahn's algorithm; ties broken by the
 * declared position) with unknown-dependency and cycle detection.
 */
export function orderOperations(
  operations: readonly Pick<Operation, 'id' | 'dependsOn'>[],
): OrderResult {
  const errors: OrderResult['errors'] = [];
  const index = new Map<string, number>();
  operations.forEach((op, i) => {
    if (index.has(op.id))
      errors.push({
        code: 'DUPLICATE_OPERATION_ID',
        message: `Operation ID "${op.id}" is used more than once.`,
        operationId: op.id,
      });
    index.set(op.id, i);
  });
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const op of operations) {
    indegree.set(op.id, 0);
    dependents.set(op.id, []);
  }
  for (const op of operations) {
    for (const dep of op.dependsOn ?? []) {
      if (!index.has(dep)) {
        errors.push({
          code: 'UNKNOWN_DEPENDENCY',
          message: `"${op.id}" depends on unknown operation "${dep}".`,
          operationId: op.id,
        });
        continue;
      }
      if (dep === op.id) {
        errors.push({
          code: 'SELF_DEPENDENCY',
          message: `"${op.id}" depends on itself.`,
          operationId: op.id,
        });
        continue;
      }
      indegree.set(op.id, (indegree.get(op.id) ?? 0) + 1);
      dependents.get(dep)!.push(op.id);
    }
  }
  const ready = operations.filter((op) => indegree.get(op.id) === 0).map((op) => op.id);
  const order: string[] = [];
  while (ready.length) {
    ready.sort((a, b) => index.get(a)! - index.get(b)!);
    const id = ready.shift()!;
    order.push(id);
    for (const next of dependents.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) ready.push(next);
    }
  }
  if (
    order.length < operations.length &&
    !errors.some((e) => e.code === 'DUPLICATE_OPERATION_ID')
  ) {
    const stuck = operations.filter((op) => !order.includes(op.id)).map((op) => op.id);
    errors.push({
      code: 'DEPENDENCY_CYCLE',
      message: `Dependency cycle among: ${stuck.join(', ')}.`,
    });
  }
  return { order, errors };
}

/** All operations that transitively depend on `id`. */
export function dependentsOf(
  operations: readonly Pick<Operation, 'id' | 'dependsOn'>[],
  id: string,
): Set<string> {
  const result = new Set<string>();
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const op of operations) {
      if (!result.has(op.id) && op.dependsOn.some((d) => frontier.includes(d))) {
        result.add(op.id);
        next.push(op.id);
      }
    }
    frontier = next;
  }
  return result;
}
