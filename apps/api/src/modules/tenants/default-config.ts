import type { WorkspaceConfig } from '@bms/types';
import { workspaceConfigSchema } from '@bms/validators';

export interface DefaultConfigInput {
  legalName: string;
  currency?: string;
  timezone?: string;
  language?: string;
  country?: string;
}

/**
 * The configuration every new workspace starts with. The defaults live in one place,
 * `workspaceConfigSchema` (packages/validators); the Industry Profile then adjusts the result.
 */
export function createDefaultConfig(input: DefaultConfigInput): WorkspaceConfig {
  return workspaceConfigSchema.parse({
    business: { legalName: input.legalName },
    locale: {
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
      ...(input.language ? { language: input.language } : {}),
      ...(input.country ? { defaultCountry: input.country } : {}),
    },
  }) as unknown as WorkspaceConfig;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep merge of plain objects; arrays and scalars in `override` replace. */
export function mergeConfig<T extends object>(base: T, override: Json): T {
  const out: Json = { ...(base as Json) };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isObject(value) && isObject(out[key]) ? mergeConfig(out[key] as Json, value) : value;
  }
  return out as T;
}
