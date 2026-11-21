/**
 * OPT-IN live tests against a real Agiloft KB. Skipped unless configured.
 *
 * Read-only (default when AGILOFT_LIVE_BASE_URL is set):
 *   AGILOFT_LIVE_BASE_URL, AGILOFT_LIVE_KB, AGILOFT_LIVE_LANG (default en)
 *   AGILOFT_LIVE_LOGIN + AGILOFT_LIVE_PASSWORD, or AGILOFT_LIVE_CLIENT_ID + AGILOFT_LIVE_CLIENT_SECRET
 *   AGILOFT_LIVE_TABLE (optional; defaults to the first visible table)
 *
 * Writes (additionally all of):
 *   AGILOFT_LIVE_SANDBOX=true                 explicit acknowledgement the KB is a sandbox
 *   AGILOFT_LIVE_SANDBOX_TABLE               table to create a test record in
 *   AGILOFT_LIVE_SANDBOX_TEXT_FIELD          a text field to set on that record
 * Test records are named "agiloft-control-live-test-<timestamp>" and are NOT deleted
 * (deletion is not exposed by Agiloft Control); remove them manually.
 */
import { describe, expect, it } from 'vitest';
import { RestAgiloftAdapter, type LiveCredentials } from './rest-adapter.ts';
import { buildQuery } from './query.ts';

const env = process.env;
const configured = !!(env.AGILOFT_LIVE_BASE_URL && env.AGILOFT_LIVE_KB);
const writes =
  configured &&
  env.AGILOFT_LIVE_SANDBOX === 'true' &&
  !!env.AGILOFT_LIVE_SANDBOX_TABLE &&
  !!env.AGILOFT_LIVE_SANDBOX_TEXT_FIELD;

function adapter() {
  const credentials: LiveCredentials = env.AGILOFT_LIVE_CLIENT_ID
    ? {
        method: 'oauth_client_credentials',
        clientId: env.AGILOFT_LIVE_CLIENT_ID,
        clientSecret: env.AGILOFT_LIVE_CLIENT_SECRET ?? '',
      }
    : {
        method: 'password_jwt',
        login: env.AGILOFT_LIVE_LOGIN ?? '',
        password: env.AGILOFT_LIVE_PASSWORD ?? '',
      };
  const host = new URL(env.AGILOFT_LIVE_BASE_URL!).hostname;
  return new RestAgiloftAdapter({
    baseUrl: env.AGILOFT_LIVE_BASE_URL!,
    kbName: env.AGILOFT_LIVE_KB!,
    lang: env.AGILOFT_LIVE_LANG ?? 'en',
    instanceLabel: 'live-test',
    credentials,
    policy: {
      allowedHostSuffixes: ['agiloft.com'],
      onPremHosts: [host],
      allowInsecureLoopback: false,
    },
    timeoutMs: 30_000,
  });
}

describe.skipIf(!configured)('LIVE Agiloft (read-only)', () => {
  it('verifies with a read-only probe', async () => {
    const report = await adapter().verify();
    console.info(JSON.stringify(report, null, 2));
    expect(report.results.length).toBeGreaterThan(0);
  });
  it('lists tables, describes one and searches with limit 1', async () => {
    const a = adapter();
    const tables = await a.listTables();
    expect(tables.length).toBeGreaterThan(0);
    const name = env.AGILOFT_LIVE_TABLE ?? tables[0]!.name;
    const schema = await a.describeTable(name);
    expect(schema.fields.length).toBeGreaterThan(0);
    const res = await a.search({ table: name, query: '', fields: ['id'], page: 0, limit: 1 });
    expect(res.records.length).toBeLessThanOrEqual(1);
    await a.close();
  });
});

describe.skipIf(!writes)('LIVE Agiloft sandbox writes', () => {
  it('creates, reads back and updates one test record', async () => {
    const a = adapter();
    const table = env.AGILOFT_LIVE_SANDBOX_TABLE!;
    const field = env.AGILOFT_LIVE_SANDBOX_TEXT_FIELD!;
    const marker = `agiloft-control-live-test-${Date.now()}`;
    const { id } = await a.create(table, { [field]: marker });
    const back = await a.read(table, id);
    expect(back.fields[field]).toBe(marker);
    const schema = await a.describeTable(table);
    const found = await a.search({
      table,
      query: buildQuery([{ field, op: 'eq', value: marker }], 'and', schema),
      fields: ['id'],
      page: 0,
      limit: 2,
    });
    expect(found.records.map((r) => r.id)).toContain(id);
    const updated = await a.update(table, id, { [field]: `${marker}-updated` });
    expect(updated.fields[field]).toBe(`${marker}-updated`);
    await a.close();
  });
});
