/**
 * Contract tests for the live REST adapter against a local fake that returns
 * the response shapes shown in Agiloft's documentation (REST Interface,
 * REST - Login, REST - Table, REST - Lock, OAuth2). They prove the adapter
 * speaks the documented protocol; they do NOT prove a real instance behaves
 * this way. See the opt-in live tests for that.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RestAgiloftAdapter } from './rest-adapter.ts';
import { AgiloftError } from './errors.ts';

interface Seen {
  method: string;
  path: string;
  query: URLSearchParams;
  form: URLSearchParams;
  auth: string | undefined;
}

let server: Server;
let base: string;
const seen: Seen[] = [];
let mode: 'normal' | 'hang' | 'server-error' | 'redirect' = 'normal';

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString();
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x');
    const form = new URLSearchParams(await body(req));
    seen.push({
      method: req.method!,
      path: url.pathname,
      query: url.searchParams,
      form,
      auth: req.headers.authorization,
    });
    const json = (status: number, o: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(o));
    };
    if (mode === 'hang' && url.pathname.includes('EWUpdate')) return; // never respond
    if (mode === 'server-error' && url.pathname.includes('EWCreate'))
      return json(500, { success: false, message: 'Rule failed' });
    if (mode === 'redirect') {
      res.writeHead(302, { location: 'http://169.254.169.254/' });
      return res.end();
    }
    if (url.pathname === '/ewws/EWLogin') {
      if (form.get('$password') !== 'pw')
        return json(403, { success: false, message: 'Invalid login/password combination' });
      return json(200, {
        access_token: 'tok-1',
        refresh_token: 'r',
        expiration_time_unit: 'minute',
        expires_in: 15,
        authentication_scheme: 'Bearer ',
      });
    }
    if (url.pathname === '/ewws/otoken')
      return json(200, { access_token: 'oauth-tok', token_type: 'Bearer', expires_in: 3600 });
    if (
      req.headers.authorization !== 'Bearer tok-1' &&
      req.headers.authorization !== 'Bearer oauth-tok'
    )
      return json(400, { success: false, message: 'Token is expired' });
    switch (url.pathname) {
      case '/ewws/EWTable/.json':
        return json(200, {
          success: true,
          message: '',
          result: {
            tables: [
              {
                label: 'WMI Sample',
                logicalName: 'wmi_sample',
                fields: [
                  {
                    columnLabel: 'ID',
                    columnName: 'id',
                    columnType: 'BIGINT',
                    columnTypeDomain: 'swautoincrementfield',
                  },
                  {
                    columnLabel: 'Date Updated',
                    columnName: 'date_updated',
                    columnType: 'DATETIME',
                    columnTypeDomain: 'swdatetimefield',
                  },
                  {
                    columnLabel: 'Updated By',
                    columnName: '_1794_full_name',
                    columnType: 'VARCHAR',
                    columnTypeDomain: 'swshorttextfield',
                    isLinked: true,
                    linkedInfo: [
                      {
                        linkedTable: 'contacts',
                        linkedColumn: 'full_name',
                        linkedDao: '_dao3_link0',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        });
      case '/ewws/EWSearch/.json':
        return json(200, {
          success: true,
          message: '',
          result: { length: 1, EWREST_records: [{ id: 21, company_name: 'Agiloft' }] },
        });
      case '/ewws/EWRead/.json':
        return json(200, {
          success: true,
          message: '',
          result: {
            company_name: 'Agiloft',
            _1794_full_name: 'Agiloft System',
            id: 21,
            date_updated: 'Aug 21 2026 15:18',
          },
        });
      case '/ewws/EWCreate/.json':
        return json(200, { success: true, message: '', result: 353 });
      case '/ewws/EWUpdate/.json':
        return json(200, { success: true, message: '', result: { id: 21, status: 'Done' } });
      case '/ewws/EWLock/.json':
        return json(200, {
          id: 21,
          table_id: 2788,
          lock_status: req.method === 'PUT' ? 'LOCKED' : 'NO_LOCK',
          locked_by: req.method === 'PUT' ? 'integration' : undefined,
        });
      default:
        return json(404, { success: false, message: 'unknown' });
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const policy = {
  allowedHostSuffixes: ['agiloft.com'],
  onPremHosts: [],
  allowInsecureLoopback: true,
};
const adapter = (over: Partial<ConstructorParameters<typeof RestAgiloftAdapter>[0]> = {}) =>
  new RestAgiloftAdapter({
    baseUrl: base,
    kbName: 'Demo',
    lang: 'en',
    instanceLabel: 'fake',
    credentials: { method: 'password_jwt', login: 'u', password: 'pw' },
    policy,
    timeoutMs: 1_000,
    ...over,
  });

describe('REST adapter contract (documented shapes)', () => {
  it('logs in with credentials in the form body, never the URL, then uses the bearer token', async () => {
    seen.length = 0;
    const a = adapter();
    await a.listTables();
    const login = seen.find((s) => s.path === '/ewws/EWLogin')!;
    expect(login.method).toBe('POST');
    expect(login.query.toString()).toBe('');
    expect(login.form.get('$login')).toBe('u');
    const table = seen.find((s) => s.path === '/ewws/EWTable/.json')!;
    expect(table.auth).toBe('Bearer tok-1');
    expect(table.form.get('$KB')).toBe('Demo');
    expect(table.form.get('err_code_resp')).toBe('1');
    expect(table.form.has('$password')).toBe(false);
  });

  it('uses the OAuth2 client-credentials token endpoint', async () => {
    seen.length = 0;
    const a = adapter({
      credentials: { method: 'oauth_client_credentials', clientId: 'c', clientSecret: 's' },
    });
    await a.listTables();
    const tok = seen.find((s) => s.path === '/ewws/otoken')!;
    expect(tok.form.get('grant_type')).toBe('client_credentials');
    expect(seen.find((s) => s.path === '/ewws/EWTable/.json')!.auth).toBe('Bearer oauth-tok');
  });

  it('parses EWTable fields and linked info', async () => {
    const t = await adapter().describeTable('wmi_sample');
    expect(t.fields.map((f) => [f.name, f.type])).toEqual([
      ['id', 'id'],
      ['date_updated', 'datetime'],
      ['_1794_full_name', 'link'],
    ]);
    expect(t.fields[2]!.links).toEqual([{ table: 'contacts', column: 'full_name' }]);
    expect(t.fields[0]!.required).toBeNull(); // not stated in the documented example
  });

  it('sends search parameters as documented and parses results', async () => {
    seen.length = 0;
    const r = await adapter().search({
      table: 'company',
      query: "company_name='Agiloft'",
      fields: ['id', 'company_name'],
      page: 1,
      limit: 2,
    });
    const s = seen.find((x) => x.path === '/ewws/EWSearch/.json')!;
    expect(s.form.get('query')).toBe("company_name='Agiloft'");
    expect(s.form.getAll('field')).toEqual(['id', 'company_name']);
    expect(s.form.get('page')).toBe('1');
    expect(s.form.get('limit')).toBe('2');
    expect(r).toMatchObject({ total: 1, records: [{ id: '21' }] });
  });

  it('reads, creates (with QBE links) and updates', async () => {
    seen.length = 0;
    const a = adapter();
    expect((await a.read('company', '21')).fields.company_name).toBe('Agiloft');
    expect(
      await a.create('wmi_sample', { _1794_full_name: { qbe: { value: 'http://x?y' } } }),
    ).toEqual({ id: '353' });
    const c = seen.find((x) => x.path === '/ewws/EWCreate/.json')!;
    expect(c.form.get('_1794_full_name')).toBe(':http\\://x\\?y');
    expect((await a.update('wmi_sample', '21', { status: 'Done' })).fields.status).toBe('Done');
    expect(seen.some((x) => x.form.has('$operationHints'))).toBe(false);
  });

  it('uses EWLock GET/PUT/DELETE', async () => {
    const a = adapter();
    expect((await a.lock('company', '21')).status).toBe('LOCKED');
    expect((await a.unlock('company', '21')).status).toBe('NO_LOCK');
  });

  it('classifies a write timeout as an unknown outcome and does not retry it', async () => {
    mode = 'hang';
    seen.length = 0;
    try {
      await expect(
        adapter({ timeoutMs: 300 }).update('wmi_sample', '21', { status: 'Done' }),
      ).rejects.toSatisfy(
        (e: unknown) =>
          e instanceof AgiloftError && e.kind === 'timeout' && e.writeOutcome === 'unknown',
      );
      expect(seen.filter((x) => x.path === '/ewws/EWUpdate/.json')).toHaveLength(1);
    } finally {
      mode = 'normal';
    }
  });

  it('treats a 5xx on a write as ambiguous', async () => {
    mode = 'server-error';
    try {
      await expect(adapter().create('wmi_sample', { x: '1' })).rejects.toSatisfy(
        (e: unknown) => e instanceof AgiloftError && e.writeOutcome === 'unknown',
      );
    } finally {
      mode = 'normal';
    }
  });

  it('never follows redirects', async () => {
    mode = 'redirect';
    try {
      await expect(adapter().listTables()).rejects.toSatisfy(
        (e: unknown) => e instanceof AgiloftError && /redirect/.test(e.message),
      );
    } finally {
      mode = 'normal';
    }
  });

  it('reports bad credentials without echoing them', async () => {
    const err = await adapter({
      credentials: { method: 'password_jwt', login: 'u', password: 'wrong-secret' },
    })
      .listTables()
      .catch((e) => e);
    expect(err).toBeInstanceOf(AgiloftError);
    expect(String(err.message)).not.toContain('wrong-secret');
  });
});
