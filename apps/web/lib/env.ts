import { z } from 'zod';

const webEnvSchema = z.object({
  API_INTERNAL_URL: z.string().url(),
  NEXT_PUBLIC_APP_NAME: z.string().min(1),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

/** Validates the web environment; throws naming each bad variable, never its value. */
export function readWebEnv(source: Record<string, string | undefined> = process.env): WebEnv {
  const result = webEnvSchema.safeParse(source);
  if (result.success) return result.data;
  const problems = result.error.issues.map((i) => `${i.path.join('.')}: invalid or missing`);
  throw new Error(
    `Invalid web environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
  );
}
