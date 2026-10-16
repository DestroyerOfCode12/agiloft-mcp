import { DEMO_RECORDS } from '@agiloft-control/test-fixtures';

export type DemoRow = Record<string, unknown>;

export type DemoFaultKind =
  /** The next matching write is rejected by "Agiloft" with a validation error. */
  | 'reject_next_write'
  /** The next matching write is applied, but the response is lost (ambiguous). */
  | 'lose_response_after_apply'
  /** The next matching write times out before reaching "Agiloft". */
  | 'timeout_before_apply';

export interface DemoFault {
  id: string;
  kind: DemoFaultKind;
  table: string | null;
  operation: 'create' | 'update' | null;
  createdAt: string;
}

/** Storage behind the demo adapter. Production code uses a database-backed store. */
export interface DemoDataStore {
  list(table: string): Promise<DemoRow[]>;
  get(table: string, id: string): Promise<DemoRow | null>;
  insert(table: string, row: DemoRow): Promise<string>;
  update(table: string, id: string, patch: DemoRow): Promise<DemoRow>;
  listFaults(): Promise<DemoFault[]>;
  addFault(fault: Omit<DemoFault, 'id' | 'createdAt'>): Promise<DemoFault>;
  takeFault(table: string, operation: 'create' | 'update'): Promise<DemoFault | null>;
  clearFaults(): Promise<void>;
  reset(): Promise<void>;
}

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryDemoStore implements DemoDataStore {
  private data: Record<string, DemoRow[]> = clone(DEMO_RECORDS);
  private faults: DemoFault[] = [];
  private seq = 0;

  async list(table: string) {
    return clone(this.data[table] ?? []);
  }
  async get(table: string, id: string) {
    const row = (this.data[table] ?? []).find((r) => r.id === id);
    return row ? clone(row) : null;
  }
  async insert(table: string, row: DemoRow) {
    const rows = (this.data[table] ??= []);
    const max = rows.reduce((m, r) => Math.max(m, Number(r.id)), 0);
    const id = String(Math.max(max + 1, 900 + rows.length));
    rows.push({ ...clone(row), id });
    return id;
  }
  async update(table: string, id: string, patch: DemoRow) {
    const rows = this.data[table] ?? [];
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error('not found');
    rows[idx] = { ...rows[idx], ...clone(patch), id };
    return clone(rows[idx]!);
  }
  async listFaults() {
    return clone(this.faults);
  }
  async addFault(fault: Omit<DemoFault, 'id' | 'createdAt'>) {
    const full = { ...fault, id: `fault-${++this.seq}`, createdAt: new Date().toISOString() };
    this.faults.push(full);
    return clone(full);
  }
  async takeFault(table: string, operation: 'create' | 'update') {
    const idx = this.faults.findIndex(
      (f) =>
        (f.table === null || f.table === table) &&
        (f.operation === null || f.operation === operation),
    );
    if (idx < 0) return null;
    const [fault] = this.faults.splice(idx, 1);
    return fault ?? null;
  }
  async clearFaults() {
    this.faults = [];
  }
  async reset() {
    this.data = clone(DEMO_RECORDS);
    this.faults = [];
  }
}
