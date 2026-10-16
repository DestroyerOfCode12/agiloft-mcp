import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => ['true', '1', 'yes'].includes(v));
const list = (fallback = '') =>
  z
    .string()
    .default(fallback)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** postgres://… for deployments; pglite:<dir> or pglite:memory for local/test use. */
  DATABASE_URL: z.string().default('pglite:./.data/pglite'),
  /** 32 bytes, base64. Encrypts stored Agiloft credentials. Required in production. */
  APP_ENCRYPTION_KEY: z.string().optional(),
  APP_ENCRYPTION_KEY_ID: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/)
    .default('k1'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),
  PORT: z.coerce.number().int().default(8080),
  AUTH_MODE: z.enum(['oidc', 'dev']).default('dev'),
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_SCOPES: z.string().default('openid email profile'),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 14)
    .default(12),
  DEMO_MODE: bool.default(true),
  AGILOFT_ALLOWED_HOST_SUFFIXES: list('agiloft.com'),
  AGILOFT_ONPREM_HOSTS: list(),
  /** Test-only: allow http://127.0.0.1 destinations for adapter contract tests. Refused in production. */
  AGILOFT_ALLOW_INSECURE_LOOPBACK: bool.default(false),
  AGILOFT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
  WORKER_EMBEDDED: bool.default(true),
  WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3_650).default(365),
  MODEL_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  MCP_HTTP_PORT: z.coerce.number().int().default(8090),
  MCP_RESOURCE_URL: z.string().url().default('http://localhost:8090/mcp'),
  MCP_OAUTH_ISSUER: z.string().url().optional(),
  MCP_OAUTH_JWKS_URL: z.string().url().optional(),
  MCP_OAUTH_AUDIENCE: z.string().optional(),
  /** Local development only: a static bearer token for the HTTP MCP endpoint. Refused in production. */
  MCP_DEV_TOKEN: z.string().min(24).optional(),
  MCP_DEV_TOKEN_USER_EMAIL: z.string().email().default('oli.operator@demo.local'),
  MCP_STDIO_USER_EMAIL: z.string().email().default('oli.operator@demo.local'),
  MCP_ALLOWED_ORIGIN_HOSTS: list(),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  encryptionKey: Buffer;
  encryptionKeyEphemeral: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const c = parsed.data;
  const prod = c.NODE_ENV === 'production';

  if (prod) {
    // Development conveniences can never be active in production.
    if (c.AUTH_MODE === 'dev')
      throw new Error('AUTH_MODE=dev is not permitted when NODE_ENV=production. Configure OIDC.');
    if (c.MCP_DEV_TOKEN)
      throw new Error('MCP_DEV_TOKEN is not permitted when NODE_ENV=production.');
    if (c.AGILOFT_ALLOW_INSECURE_LOOPBACK)
      throw new Error('AGILOFT_ALLOW_INSECURE_LOOPBACK is not permitted in production.');
    if (!c.APP_ENCRYPTION_KEY) throw new Error('APP_ENCRYPTION_KEY is required in production.');
    if (c.DATABASE_URL.startsWith('pglite:'))
      throw new Error('Embedded PGlite is not supported in production; use PostgreSQL.');
    if (!c.PUBLIC_BASE_URL.startsWith('https://'))
      throw new Error('PUBLIC_BASE_URL must use https in production.');
  }
  if (c.AUTH_MODE === 'oidc' && (!c.OIDC_ISSUER || !c.OIDC_CLIENT_ID)) {
    throw new Error('AUTH_MODE=oidc requires OIDC_ISSUER and OIDC_CLIENT_ID.');
  }
  if (c.MODEL_PROVIDER === 'anthropic' && !c.ANTHROPIC_API_KEY) {
    throw new Error('MODEL_PROVIDER=anthropic requires ANTHROPIC_API_KEY.');
  }

  let encryptionKey: Buffer;
  let encryptionKeyEphemeral = false;
  if (c.APP_ENCRYPTION_KEY) {
    encryptionKey = Buffer.from(c.APP_ENCRYPTION_KEY, 'base64');
    if (encryptionKey.length !== 32)
      throw new Error('APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded.');
  } else {
    encryptionKey = randomBytes(32);
    encryptionKeyEphemeral = true;
  }
  return { ...c, encryptionKey, encryptionKeyEphemeral };
}
