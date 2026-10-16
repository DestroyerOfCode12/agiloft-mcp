import { z } from 'zod';

/** Normalised field types. `unknown` is used whenever the source type is not recognised. */
export const FieldTypeSchema = z.enum([
  'id',
  'text',
  'longtext',
  'integer',
  'decimal',
  'currency',
  'date',
  'datetime',
  'time',
  'choice',
  'multichoice',
  'link',
  'file',
  'email',
  'url',
  'boolean',
  'unknown',
]);
export type FieldType = z.infer<typeof FieldTypeSchema>;

export const LinkInfoSchema = z.object({
  table: z.string(),
  column: z.string(),
});

export const FieldSchemaSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: FieldTypeSchema,
  /** Raw Agiloft column type domain, e.g. "swshorttextfield". */
  rawType: z.string().optional(),
  /** `null` means the source did not state whether the field is required. */
  required: z.boolean().nullable(),
  readOnly: z.boolean().optional(),
  links: z.array(LinkInfoSchema).optional(),
  choices: z.array(z.string()).optional(),
});
export type FieldSchema = z.infer<typeof FieldSchemaSchema>;

export const TableSchemaSchema = z.object({
  name: z.string(),
  label: z.string(),
  fields: z.array(FieldSchemaSchema),
  /** Where the definition came from, for honest display. */
  source: z.enum(['agiloft:EWTable', 'demo-adapter']),
  retrievedAt: z.string(),
});
export type TableSchema = z.infer<typeof TableSchemaSchema>;

export interface TableSummary {
  name: string;
  label: string;
  fieldCount: number | null;
}

export interface Relationship {
  fromTable: string;
  fromField: string;
  toTable: string;
  toColumn: string;
}

export function relationshipsOf(table: TableSchema): Relationship[] {
  return table.fields.flatMap((f) =>
    (f.links ?? []).map((l) => ({
      fromTable: table.name,
      fromField: f.name,
      toTable: l.table,
      toColumn: l.column,
    })),
  );
}

/** Logical names are identifiers; anything else is rejected before reaching Agiloft. */
export const LOGICAL_NAME = /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/;

export const RecordIdSchema = z
  .string()
  .regex(/^[0-9]{1,18}$/, 'Record IDs are numeric identifiers');

export interface AgiloftRecord {
  id: string;
  fields: Record<string, unknown>;
}
