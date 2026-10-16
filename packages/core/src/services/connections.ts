import { z } from 'zod';
import { AppError, EnvironmentSchema, newId, type Environment } from '@agiloft-control/shared';
import {
  AgiloftError,
  checkResolvedAddresses,
  DemoAgiloftAdapter,
  RestAgiloftAdapter,
  validateBaseUrl,
  type AgiloftAdapter,
  type DestinationPolicy,
  type LiveCredentials,
  type VerificationReport,
} from '@agiloft-control/agiloft-client';
import type { InstanceCapabilityResult } from '@agiloft-control/capabilities';
import type { Db } from '../db/index.ts';
import type { SecretBox } from '../crypto.ts';
import { DbDemoStore } from './demo-store.ts';

export const LiveConnectionInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  environment: EnvironmentSchema.exclude(['demo']),
  baseUrl: z.string().url().max(300),
  kbName: z.string().trim().min(1).max(120),
  lang: z
    .string()
    .regex(/^[a-z]{2}$/)
    .default('en'),
  auth: z.discriminatedUnion('method', [
    z.object({
      method: z.literal('password_jwt'),
      login: z.string().min(1).max(200),
      password: z.string().min(1).max(500),
    }),
    z.object({
      method: z.literal('oauth_client_credentials'),
      clientId: z.string().min(1).max(300),
      clientSecret: z.string().min(1).max(1000),
    }),
  ]),
});
export type LiveConnectionInput = z.input<typeof LiveConnectionInputSchema>;

export const ConnectionUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  baseUrl: z.string().url().max(300).optional(),
  kbName: z.string().trim().min(1).max(120).optional(),
  lang: z
    .string()
    .regex(/^[a-z]{2}$/)
    .optional(),
  disabled: z.boolean().optional(),
  auth: LiveConnectionInputSchema.shape.auth.optional(),
});

export interface ConnectionView {
  id: string;
  name: string;
  environment: Environment;
  mode: 'demo' | 'live';
  baseUrl: string | null;
  kbName: string;
  lang: string;
  authMethod: string;
  /** Masked hint of the integration principal, e.g. "int•••••ion". Secrets are never returned. */
  principalHint: string | null;
  credentialsStored: boolean;
  identityNote: string;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastVerification: VerificationReport | null;
}

export interface ConnectionRow {
  id: string;
  environment: Environment;
  mode: 'demo' | 'live';
  disabled: boolean;
  kbName: string;
  name: string;
}

function hint(value: string): string {
  if (value.length <= 4) return '••••';
  return `${value.slice(0, 3)}•••••${value.slice(-2)}`;
}

export class ConnectionService {
  private adapters = new Map<string, AgiloftAdapter>();

  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly destinationPolicy: DestinationPolicy,
    private readonly timeoutMs: number,
  ) {}

  private toView(r: Awaited<ReturnType<ConnectionService['row']>>): ConnectionView {
    return {
      id: r.id,
      name: r.name,
      environment: r.environment as Environment,
      mode: r.mode,
      baseUrl: r.base_url,
      kbName: r.kb_name,
      lang: r.lang,
      authMethod: r.auth_method,
      principalHint: r.principal_hint,
      credentialsStored: !!r.secret_ciphertext,
      identityNote:
        r.mode === 'demo'
          ? 'Demo adapter: no Agiloft identity is used.'
          : 'All Agiloft actions run under this shared integration identity. Agiloft history shows the integration user, not the individual who approved or executed the plan; Agiloft Control’s audit log records the individual.',
      disabled: r.disabled,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
      lastVerification: (r.last_verification as unknown as VerificationReport | null) ?? null,
    };
  }

  private async row(id: string) {
    const r = await this.db
      .selectFrom('connections')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw new AppError('NOT_FOUND', 'Connection not found.');
    return r;
  }

  async list(): Promise<ConnectionView[]> {
    const rows = await this.db
      .selectFrom('connections')
      .selectAll()
      .orderBy('created_at')
      .execute();
    return rows.map((r) => this.toView(r));
  }

  async get(id: string): Promise<ConnectionView> {
    return this.toView(await this.row(id));
  }

  async meta(id: string): Promise<ConnectionRow> {
    const r = await this.row(id);
    return {
      id: r.id,
      environment: r.environment as Environment,
      mode: r.mode,
      disabled: r.disabled,
      kbName: r.kb_name,
      name: r.name,
    };
  }

  async instanceCapabilities(id: string): Promise<InstanceCapabilityResult[]> {
    const v = (await this.row(id)).last_verification as unknown as VerificationReport | null;
    return v?.results ?? [];
  }

  async ensureDemoConnection(createdBy: string, id = 'conn_demo'): Promise<string> {
    const existing = await this.db
      .selectFrom('connections')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!existing) {
      await this.db
        .insertInto('connections')
        .values({
          id,
          name: 'Acme Demo (synthetic)',
          environment: 'demo',
          mode: 'demo',
          base_url: null,
          kb_name: 'AcmeDemo',
          lang: 'en',
          auth_method: 'none',
          secret_ciphertext: null,
          principal_hint: null,
          created_by: createdBy,
        })
        .execute();
    }
    await new DbDemoStore(this.db, id).seedIfEmpty();
    return id;
  }

  async createLive(input: LiveConnectionInput, createdBy: string): Promise<ConnectionView> {
    const data = LiveConnectionInputSchema.parse(input);
    const dest = validateBaseUrl(data.baseUrl, this.destinationPolicy);
    await checkResolvedAddresses(dest, this.destinationPolicy);
    const id = newId('conn');
    await this.db
      .insertInto('connections')
      .values({
        id,
        name: data.name,
        environment: data.environment,
        mode: 'live',
        base_url: dest.url.toString().replace(/\/+$/, ''),
        kb_name: data.kbName,
        lang: data.lang,
        auth_method: data.auth.method,
        secret_ciphertext: this.box.seal(JSON.stringify(data.auth), id),
        principal_hint: hint(
          data.auth.method === 'password_jwt' ? data.auth.login : data.auth.clientId,
        ),
        created_by: createdBy,
      })
      .execute();
    return this.get(id);
  }

  async update(id: string, patch: z.input<typeof ConnectionUpdateSchema>): Promise<ConnectionView> {
    const data = ConnectionUpdateSchema.parse(patch);
    const current = await this.row(id);
    if (current.mode === 'demo' && (data.baseUrl || data.auth)) {
      throw new AppError('VALIDATION_FAILED', 'The demo connection has no URL or credentials.');
    }
    let baseUrl = current.base_url;
    if (data.baseUrl) {
      const dest = validateBaseUrl(data.baseUrl, this.destinationPolicy);
      await checkResolvedAddresses(dest, this.destinationPolicy);
      baseUrl = dest.url.toString().replace(/\/+$/, '');
    }
    await this.db
      .updateTable('connections')
      .set({
        ...(data.name ? { name: data.name } : {}),
        ...(data.kbName ? { kb_name: data.kbName } : {}),
        ...(data.lang ? { lang: data.lang } : {}),
        ...(data.disabled !== undefined ? { disabled: data.disabled } : {}),
        base_url: baseUrl,
        ...(data.auth
          ? {
              auth_method: data.auth.method,
              secret_ciphertext: this.box.seal(JSON.stringify(data.auth), id),
              principal_hint: hint(
                data.auth.method === 'password_jwt' ? data.auth.login : data.auth.clientId,
              ),
            }
          : {}),
        // Any change to where or how we connect invalidates previous verification.
        ...(data.baseUrl || data.auth || data.kbName
          ? { last_verification: null, last_verified_at: null }
          : {}),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
    await this.dropAdapter(id);
    return this.get(id);
  }

  async verify(id: string): Promise<VerificationReport> {
    const adapter = await this.adapter(id);
    let report: VerificationReport;
    try {
      report = await adapter.verify();
    } catch (e) {
      const err = e as Error;
      report = {
        checkedAt: new Date().toISOString(),
        identity: adapter.identity,
        ok: false,
        summary: e instanceof AgiloftError ? err.message : 'Verification failed unexpectedly.',
        latencyMs: 0,
        tablesVisible: null,
        results: [],
      };
    }
    await this.db
      .updateTable('connections')
      .set({
        last_verification: JSON.stringify(report),
        last_verified_at: new Date(report.checkedAt),
      })
      .where('id', '=', id)
      .execute();
    return report;
  }

  /**
   * Returns the adapter for a connection. Demo connections always get the demo
   * adapter and live connections always get the live adapter; a failed live
   * connection never falls back to demo data.
   */
  async adapter(id: string): Promise<AgiloftAdapter> {
    const cached = this.adapters.get(id);
    if (cached) return cached;
    const r = await this.row(id);
    if (r.disabled) throw new AppError('INVALID_STATE', 'This connection is disabled.');
    let adapter: AgiloftAdapter;
    if (r.mode === 'demo') {
      adapter = new DemoAgiloftAdapter(new DbDemoStore(this.db, id));
    } else {
      if (!r.secret_ciphertext || !r.base_url)
        throw new AppError('NOT_CONFIGURED', 'This connection has no stored credentials.');
      let credentials: LiveCredentials;
      try {
        credentials = JSON.parse(this.box.open(r.secret_ciphertext, id)) as LiveCredentials;
      } catch {
        throw new AppError(
          'NOT_CONFIGURED',
          'Stored credentials cannot be decrypted with the current APP_ENCRYPTION_KEY. Re-enter the credentials.',
        );
      }
      adapter = new RestAgiloftAdapter({
        baseUrl: r.base_url,
        kbName: r.kb_name,
        lang: r.lang,
        instanceLabel: r.name,
        credentials,
        policy: this.destinationPolicy,
        timeoutMs: this.timeoutMs,
      });
    }
    this.adapters.set(id, adapter);
    return adapter;
  }

  demoStore(id: string): DbDemoStore {
    return new DbDemoStore(this.db, id);
  }

  async dropAdapter(id: string) {
    const a = this.adapters.get(id);
    this.adapters.delete(id);
    await a?.close();
  }

  async closeAll() {
    for (const id of [...this.adapters.keys()]) await this.dropAdapter(id);
  }
}
