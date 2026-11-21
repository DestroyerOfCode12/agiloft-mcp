import { z } from 'zod';

export const EnvironmentSchema = z.enum(['demo', 'development', 'staging', 'production']);
export type Environment = z.infer<typeof EnvironmentSchema>;

export const ENVIRONMENTS: readonly Environment[] = EnvironmentSchema.options;

export const ENVIRONMENT_LABELS: Record<Environment, string> = {
  demo: 'Demo',
  development: 'Development',
  staging: 'Staging',
  production: 'Production',
};
