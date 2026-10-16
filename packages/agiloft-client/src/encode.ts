import { AppError, type FieldValue } from '@agiloft-control/shared';

/**
 * Escapes ':' and '?' in Query-By-Example values as documented ("\:" and "\?").
 * Backslashes have no documented escape, so values containing them are rejected.
 */
export function escapeQbe(value: string): string {
  if (value.includes('\\')) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Linked-field values containing a backslash are not supported (no documented escape).',
    );
  }
  return value.replace(/:/g, '\\:').replace(/\?/g, '\\?');
}

/** Encodes plan field values into form parameters for EWCreate/EWUpdate. */
export function encodeValues(
  values: Record<string, FieldValue>,
  into: URLSearchParams,
): URLSearchParams {
  for (const [name, value] of Object.entries(values)) {
    if (value === null) into.append(name, '');
    else if (Array.isArray(value)) for (const v of value) into.append(name, v);
    else if (typeof value === 'object') {
      into.append(name, `${value.qbe.table ?? ''}:${escapeQbe(value.qbe.value)}`);
    } else into.append(name, String(value));
  }
  return into;
}
