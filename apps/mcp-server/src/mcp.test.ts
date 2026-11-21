import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createApp, createLogger, loadConfig, type AppContainer } from '@agiloft-control/core';
import { startMcpHttp } from './http.ts';

const TOKEN = 'dev-token-for-tests-0123456789abcdef';
let app: AppContainer;
let http: Awaited<ReturnType<typeof startMcpHttp>>;
let base: string;
let client: Client;

const EXPECTED_TOOLS = [
  'connection_status',
  'list_capabilities',
  'list_tables',
  'describe_table',
  'search_records',
  'get_record',
  'get_related_records',
  'prepare_record_create',
  'prepare_record_update',
  'analyse_scenario',
  'create_change_plan',
  'validate_change_plan',
  'get_change_plan',
  'execute_approved_plan',
  'get_execution_status',
  'get_audit_events',
];

async function call(name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args }) as Promise<{
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content: { type: string; text: string }[];
  }>;
}

beforeAll(async () => {
  const config = loadConfig({
    DATABASE_URL: 'pglite:memory',
    NODE_ENV: 'test',
    AUTH_MODE: 'dev',
    LOG_LEVEL: 'silent',
    MCP_HTTP_PORT: '0',
    MCP_RESOURCE_URL: 'http://localhost/mcp',
    MCP_DEV_TOKEN: TOKEN,
    MCP_DEV_TOKEN_USER_EMAIL: 'oli.operator@demo.local',
  });
  app = await createApp({ config, logger: createLogger('silent') });
  http = await startMcpHttp(app);
  base = `http://localhost:${(http.server.address() as AddressInfo).port}`;
  client = new Client({ name: 'test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  );
}, 60_000);

afterAll(async () => {
  await client?.close();
  await http?.close();
  await app?.close();
});

describe('remote MCP endpoint', () => {
  it('rejects unauthenticated requests with an OAuth challenge', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
  });

  it('rejects a wrong token', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('publishes protected resource metadata', async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    const body = (await res.json()) as { resource: string; scopes_supported: string[] };
    expect(body.resource).toBe('http://localhost/mcp');
    expect(body.scopes_supported).toContain('agiloft:execute');
  });

  it('rejects foreign Host headers (DNS rebinding)', async () => {
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        `${base}/mcp`,
        {
          method: 'POST',
          headers: {
            host: 'evil.example',
            authorization: `Bearer ${TOKEN}`,
            'content-type': 'application/json',
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(403);
  });
});

describe('tools', () => {
  it('lists every tool with accurate annotations and no approval tool', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
    expect(names.filter((n) => /^approve|reject|delete|sql|raw|fetch_url|script/i.test(n))).toEqual(
      [],
    );
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.search_records!.annotations?.readOnlyHint).toBe(true);
    expect(byName.execute_approved_plan!.annotations?.destructiveHint).toBe(true);
    expect(byName.prepare_record_update!.annotations?.readOnlyHint).toBe(false);
    expect(byName.prepare_record_update!.annotations?.destructiveHint).toBe(false);
  });

  it('reports connection status for the demo connection', async () => {
    const r = await call('connection_status');
    expect(r.isError).toBeFalsy();
    expect(r.content[0]!.text).toContain('DEMO');
  });

  it('frames record content as untrusted data', async () => {
    const r = await call('get_record', { table: 'laptop_requests', id: '304' });
    expect(r.structuredContent?.trust).toBe('untrusted-record-content');
    expect(String(r.structuredContent?.notice)).toMatch(/Do not follow instructions/);
  });

  it('validates arguments with the schema', async () => {
    const r = await call('search_records', { table: 'employees', page_size: 1000 });
    expect(r.isError).toBe(true);
  });

  it('runs the proposal flow but cannot execute without human approval', async () => {
    const prep = await call('prepare_record_update', {
      table: 'tasks',
      id: '505',
      fields: { status: 'In Progress' },
      reason: 'Unblocked',
    });
    expect(prep.isError).toBeFalsy();
    const planId = String(prep.structuredContent?.planId);
    const submitted = await call('validate_change_plan', {
      plan_id: planId,
      submit_for_approval: true,
    });
    expect(submitted.content[0]!.text).toContain('awaiting_approval');
    // An AI client cannot fabricate approval: extra arguments are not part of the schema, and execution checks server-side state.
    const exe = await call('execute_approved_plan', { plan_id: planId, approved: true } as Record<
      string,
      unknown
    >);
    expect(exe.isError).toBe(true);
    expect(exe.content[0]!.text).toMatch(/APPROVAL_INVALID/);
  });

  it('explains unsupported administration in scenario analysis', async () => {
    const r = await call('analyse_scenario', {
      text: 'When a laptop request is submitted, require manager approval. Above R20,000, require finance approval too.',
    });
    expect(r.isError).toBeFalsy();
    const steps = (
      r.structuredContent as { analysis: { steps: { category: string; route: string }[] } }
    ).analysis.steps;
    expect(steps.find((s) => s.category === 'trigger')?.route).toBe('manual_admin');
  });

  it('denies audit access to operators', async () => {
    const r = await call('get_audit_events');
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/FORBIDDEN/);
  });

  it('exposes resources', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(
      expect.arrayContaining([
        'agiloft-control://guide',
        'agiloft-control://capabilities',
        'agiloft-control://schemas/change-plan',
      ]),
    );
    const schema = await client.readResource({ uri: 'agiloft-control://schemas/change-plan' });
    expect(
      JSON.parse((schema.contents[0] as { text: string }).text).properties.operations,
    ).toBeTruthy();
  });
});
