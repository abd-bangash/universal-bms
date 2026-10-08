import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const duration = z.string().regex(/^\d+[smhd]$/, 'must look like 15m, 12h or 30d');
const pem = z
  .string()
  .min(1)
  .transform((v) => v.replace(/\\n/g, '\n'))
  .refine((v) => v.includes('-----BEGIN'), 'must be a PEM encoded key');
const url = (what: string) => z.string().url(`must be a valid ${what}`);

const encryptionKey = z.string().refine((v) => {
  const bytes = Buffer.from(v, 'base64');
  return bytes.length === 32 && bytes.toString('base64') === v;
}, 'must be 32 random bytes encoded as base64');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    APP_ENV: z.enum(['development', 'testing', 'production']),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a PostgreSQL connection URL'),
    REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a Redis connection URL'),
    JWT_PRIVATE_KEY: pem,
    JWT_PUBLIC_KEY: pem,
    ACCESS_TOKEN_TTL: duration,
    REFRESH_TOKEN_TTL: duration,
    INTEGRATION_ENCRYPTION_KEY: encryptionKey,
    STORAGE_DRIVER: z.enum(['local', 's3']),
    S3_ENDPOINT: url('URL').optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY: z.string().min(1).optional(),
    S3_SECRET_KEY: z.string().min(1).optional(),
    S3_REGION: z.string().min(1).optional(),
    MAX_UPLOAD_MB: z.coerce.number().int().positive(),
    WEB_ORIGIN: url('origin'),
    API_BASE_URL: url('URL'),
    WORKERS_IN_PROCESS: bool,
    META_APP_SECRET: z.string().min(1),
    META_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
    SMTP_URL: z.string().min(1).optional(),
    SENTRY_DSN: z.string().min(1).optional(),
    ALLOW_PUBLIC_SIGNUP: bool,
    PLATFORM_AUTOMATION_ENABLED: bool,
    SEED_ALLOW_PRODUCTION: bool,
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER !== 's3') return;
    for (const key of [
      'S3_ENDPOINT',
      'S3_BUCKET',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'S3_REGION',
    ] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'is required when STORAGE_DRIVER is s3',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Injection token for the validated environment. */
export const ENV = Symbol('ENV');

export class EnvValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

/**
 * Validates a raw environment. Messages name the variable and the rule only,
 * never the supplied value, so secrets cannot leak through error output.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => {
    const name = issue.path.join('.') || 'environment';
    const missing = source[name] === undefined && issue.path.length > 0;
    return `${name}: ${missing ? 'is required' : issue.message}`;
  });
  throw new EnvValidationError(problems);
}

let cached: Env | undefined;

/** Reads process.env once. Call at startup; the process exits on failure. */
export function loadEnv(): Env {
  if (cached) return cached;
  try {
    cached = parseEnv(process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  return cached;
}
