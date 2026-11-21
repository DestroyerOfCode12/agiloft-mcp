import { describe, expect, it } from 'vitest';
import { DEMO_TABLES } from '@agiloft-control/test-fixtures';
import { AppError, redact, redactUrl } from '@agiloft-control/shared';
import { buildQuery, formatAgiloftDate, resolveFields } from './query.ts';
import { classifyAddress, validateBaseUrl } from './url-safety.ts';
import { escapeQbe } from './encode.ts';
import { DemoAgiloftAdapter, compileQuery } from './demo-adapter.ts';
import { MemoryDemoStore } from './demo-store.ts';
import { AgiloftError } from './errors.ts';

const requests = DEMO_TABLES.find((t) => t.name === 'laptop_requests')!;

describe('query builder (documented EWSearch syntax)', () => {
  it('builds quoted conditions joined with && or ||', () => {
    expect(
      buildQuery(
        [
          { field: 'status', op: 'eq', value: 'Submitted' },
          { field: 'amount', op: 'gt', value: 20000 },
        ],
        'and',
        requests,
      ),
    ).toBe("status='Submitted'&&amount>'20000'");
    expect(
      buildQuery(
        [
          { field: 'summary', op: 'contains', value: 'laptop' },
          { field: 'needed_by', op: 'is_empty' },
        ],
        'or',
        requests,
      ),
    ).toBe("summary~='laptop'||needed_by=null");
  });
  it('formats dates like the documented example', () => {
    expect(formatAgiloftDate('2021-08-24')).toBe('Aug 24 2021 00:00');
    expect(
      buildQuery([{ field: 'needed_by', op: 'gte', value: '2026-10-01' }], 'and', requests),
    ).toBe("needed_by>='Oct 01 2026 00:00'");
  });
  it('rejects anything the syntax cannot express safely', () => {
    const bad =
      (value: string, field = 'summary') =>
      () =>
        buildQuery([{ field, op: 'eq', value }], 'and', requests);
    expect(bad("O'Brien")).toThrow(AppError);
    expect(bad('a&&b')).toThrow(AppError);
    expect(bad('a||b')).toThrow(AppError);
    expect(bad('x\n')).toThrow(AppError);
    expect(bad('x', 'not_a_field')).toThrow(/does not exist/);
    expect(() =>
      buildQuery([{ field: 'amount', op: 'contains', value: '1' }], 'and', requests),
    ).toThrow(/text-like/);
    expect(() => buildQuery([{ field: 'summary', op: 'gt', value: 'a' }], 'and', requests)).toThrow(
      /numeric and date/,
    );
  });
  it('bounds default field selection', () => {
    expect(resolveFields(undefined, requests).length).toBeLessThanOrEqual(9);
    expect(() => resolveFields(['nope'], requests)).toThrow();
  });
  it('round-trips through the demo adapter parser', () => {
    const pred = compileQuery("status='Submitted'||amount>'40000'", requests);
    expect(pred({ status: 'Submitted', amount: 1 })).toBe(true);
    expect(pred({ status: 'Draft', amount: 48900 })).toBe(true);
    expect(pred({ status: 'Draft', amount: 100 })).toBe(false);
  });
});

describe('URL safety (SSRF)', () => {
  const policy = {
    allowedHostSuffixes: ['agiloft.com'],
    onPremHosts: ['agiloft.corp.example', '10.1.2.3'],
    allowInsecureLoopback: false,
  };
  it('accepts approved cloud and on-premises hosts over HTTPS', () => {
    expect(validateBaseUrl('https://acme.agiloft.com', policy).onPrem).toBe(false);
    expect(validateBaseUrl('https://agiloft.corp.example:8443/agiloft', policy).onPrem).toBe(true);
    expect(validateBaseUrl('https://10.1.2.3', policy).onPrem).toBe(true);
  });
  it.each([
    ['http://acme.agiloft.com', /HTTPS/],
    ['https://evil.example.com', /not an approved/],
    ['https://agiloft.com.evil.example', /not an approved/],
    ['https://user:pw@acme.agiloft.com', /Credentials/],
    ['https://acme.agiloft.com/?x=1', /query string/],
    ['https://169.254.169.254', /IP-address/],
    ['https://localhost', /Loopback/],
    ['https://acme.agiloft.com:8080', /Non-standard ports/],
    ['not a url', /valid/],
  ])('rejects %s', (url, msg) => {
    expect(() => validateBaseUrl(url, policy)).toThrow(msg);
  });
  it('classifies resolved addresses', () => {
    expect(classifyAddress('169.254.169.254')).toBe('blocked');
    expect(classifyAddress('127.0.0.1')).toBe('blocked');
    expect(classifyAddress('::ffff:127.0.0.1')).toBe('blocked');
    expect(classifyAddress('10.0.0.5')).toBe('private');
    expect(classifyAddress('fd00::1')).toBe('private');
    expect(classifyAddress('52.1.2.3')).toBe('public');
  });
});

describe('encoding and redaction', () => {
  it('escapes Query-By-Example values as documented', () => {
    expect(escapeQbe('http://a?b')).toBe('http\\://a\\?b');
    expect(() => escapeQbe('a\\b')).toThrow();
  });
  it('redacts credentials in objects, strings and URLs', () => {
    const r = redact({
      password: 'p',
      nested: { clientSecret: 's', note: 'Authorization: Bearer abc.def', ok: 'fine' },
      list: [{ token: 't' }],
    });
    expect(JSON.stringify(r)).not.toMatch(/"p"|"s"|abc\.def|"t"/);
    expect(r.nested.ok).toBe('fine');
    expect(
      redactUrl('https://x.agiloft.com/ewws/EWRead?$KB=a&$login=u&$password=secret'),
    ).not.toContain('secret');
  });
});

describe('demo adapter semantics', () => {
  it('enforces required fields, choices and unambiguous links', async () => {
    const a = new DemoAgiloftAdapter(new MemoryDemoStore());
    await expect(a.create('tasks', { status: 'Done' })).rejects.toThrow(/required/);
    await expect(a.create('tasks', { title: 'x', status: 'Nope' })).rejects.toThrow(/not a choice/);
    await expect(
      a.create('tasks', { title: 'x', assigned_team: { qbe: { value: 'No Such Team' } } }),
    ).rejects.toThrow(/No linked records/);
    const { id } = await a.create('tasks', {
      title: 'x',
      assigned_team: { qbe: { value: 'Finance' } },
    });
    expect((await a.read('tasks', id)).fields.assigned_team).toBe('Finance');
  });
  it('maintains date_updated and fires a simulated rule on API writes', async () => {
    const store = new MemoryDemoStore();
    const a = new DemoAgiloftAdapter(store, { now: () => new Date('2026-10-16T10:00:00Z') });
    const after = await a.update('laptop_requests', '304', { status: 'Pending Manager Approval' });
    expect(after.fields.date_updated).toBe('2026-10-16T10:00:00.000Z');
    expect((await store.list('notifications')).length).toBe(1);
  });
  it('injects faults with the right write outcome', async () => {
    const store = new MemoryDemoStore();
    const a = new DemoAgiloftAdapter(store);
    await store.addFault({
      kind: 'lose_response_after_apply',
      table: 'tasks',
      operation: 'create',
    });
    const err = await a.create('tasks', { title: 'applied anyway' }).catch((e) => e);
    expect(err).toBeInstanceOf(AgiloftError);
    expect(err.writeOutcome).toBe('unknown');
    expect((await store.list('tasks')).some((t) => t.title === 'applied anyway')).toBe(true);
  });
  it('reports synthetic verification and never a network identity', async () => {
    const r = await new DemoAgiloftAdapter(new MemoryDemoStore()).verify();
    expect(r.identity.baseUrl).toBeNull();
    expect(r.results.every((x) => x.synthetic)).toBe(true);
    expect(r.results.find((x) => x.capabilityId === 'admin.rules')?.status).toBe('unsupported');
  });
});
