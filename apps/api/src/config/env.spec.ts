import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { EnvValidationError, parseEnv } from './env';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const valid = (): Record<string, string> => ({
  NODE_ENV: 'test',
  APP_ENV: 'development',
  DATABASE_URL: 'postgresql://bms:bms@localhost:5432/bms',
  REDIS_URL: 'redis://localhost:6379',
  JWT_PRIVATE_KEY: privateKey,
  JWT_PUBLIC_KEY: publicKey,
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL: '30d',
  INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'bms',
  S3_ACCESS_KEY: 'access',
  S3_SECRET_KEY: 'secret',
  S3_REGION: 'us-east-1',
  MAX_UPLOAD_MB: '10',
  WEB_ORIGIN: 'http://localhost:3000',
  API_BASE_URL: 'http://localhost:4000',
  WORKERS_IN_PROCESS: 'true',
  META_APP_SECRET: 'meta-secret',
  META_WEBHOOK_VERIFY_TOKEN: 'verify-token',
  ALLOW_PUBLIC_SIGNUP: 'false',
  PLATFORM_AUTOMATION_ENABLED: 'false',
  SEED_ALLOW_PRODUCTION: 'false',
});

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvValidationError) return error.problems;
    throw error;
  }
  return [];
}

describe('parseEnv', () => {
  it('accepts a complete environment and converts types', () => {
    const env = parseEnv(valid());
    expect(env.MAX_UPLOAD_MB).toBe(10);
    expect(env.WORKERS_IN_PROCESS).toBe(true);
    expect(env.ALLOW_PUBLIC_SIGNUP).toBe(false);
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it.each(Object.keys(valid()).filter((k) => !k.startsWith('S3_')))(
    'rejects a missing %s',
    (key) => {
      const source: Record<string, string | undefined> = valid();
      delete source[key];
      expect(problemsOf(source)).toEqual([expect.stringContaining(`${key}: is required`)]);
    },
  );

  it('rejects invalid values and names each variable', () => {
    const source = {
      ...valid(),
      APP_ENV: 'staging',
      DATABASE_URL: 'mysql://x',
      ACCESS_TOKEN_TTL: 'soon',
      MAX_UPLOAD_MB: '-1',
      WORKERS_IN_PROCESS: 'yes',
      INTEGRATION_ENCRYPTION_KEY: 'short',
    };
    const problems = problemsOf(source);
    for (const key of [
      'APP_ENV',
      'DATABASE_URL',
      'ACCESS_TOKEN_TTL',
      'MAX_UPLOAD_MB',
      'WORKERS_IN_PROCESS',
      'INTEGRATION_ENCRYPTION_KEY',
    ]) {
      expect(problems.some((p) => p.startsWith(`${key}:`))).toBe(true);
    }
  });

  it('requires the S3 settings only when STORAGE_DRIVER is s3', () => {
    const source: Record<string, string | undefined> = { ...valid(), STORAGE_DRIVER: 'local' };
    for (const key of Object.keys(source).filter((k) => k.startsWith('S3_'))) delete source[key];
    expect(problemsOf(source)).toEqual([]);

    const s3 = { ...source, STORAGE_DRIVER: 's3' };
    expect(problemsOf(s3)).toHaveLength(5);
  });

  it('accepts PEM keys with escaped newlines', () => {
    const escaped = { ...valid(), JWT_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n') };
    expect(parseEnv(escaped).JWT_PRIVATE_KEY).toBe(privateKey);
  });

  it('never echoes a supplied secret in the error message', () => {
    const secret = 'super-secret-value-123';
    const source = { ...valid(), INTEGRATION_ENCRYPTION_KEY: secret, DATABASE_URL: secret };
    expect(problemsOf(source).join('\n')).not.toContain(secret);
  });
});
