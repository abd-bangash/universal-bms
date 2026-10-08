import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { industryProfileSchema, type IndustryProfileDefinition } from '@bms/validators';

/** apps/api/prisma/seed/profiles, from both src/ (tests) and dist/ (production). */
export const PROFILES_DIR = resolve(__dirname, '../../../prisma/seed/profiles');

/** Reads and validates every built-in Industry Profile. Throws on an invalid file. */
export function loadBuiltInProfiles(
  dir: string = PROFILES_DIR,
): Map<string, IndustryProfileDefinition> {
  const profiles = new Map<string, IndustryProfileDefinition>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const parsed = industryProfileSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    profiles.set(parsed.key, parsed);
  }
  return profiles;
}
