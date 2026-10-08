import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { envSchema } from '../../config/env';

const blueprint = readFileSync(resolve(__dirname, '../../../../../deploy/render.yaml'), 'utf8');

/** The `- key: NAME` entries of one service block of the Blueprint. */
function variablesOf(serviceName: string): string[] {
  const start = blueprint.indexOf(`name: ${serviceName}`);
  const next = blueprint.indexOf('\n  - type:', start + 1);
  const block = blueprint.slice(start, next === -1 ? undefined : next);
  return [...block.matchAll(/- key: (\w+)/g)].map((m) => m[1] as string);
}

describe('deploy/render.yaml (Requirement 52.1, 52.3)', () => {
  const api = variablesOf('bms-api');

  it('sets or asks for every environment variable the API needs to start', () => {
    const required = Object.keys(envSchema.shape).filter(
      (key) => !['SMTP_URL', 'SENTRY_DSN'].includes(key),
    );
    const missing = required.filter((key) => !api.includes(key));
    expect(missing).toEqual([]);
  });

  it('gives the web service the two variables it validates at start', () => {
    expect(variablesOf('bms-web')).toEqual(
      expect.arrayContaining(['API_INTERNAL_URL', 'NEXT_PUBLIC_APP_NAME']),
    );
  });

  it('keeps every secret out of the file: they are asked for, not written', () => {
    for (const key of [
      'JWT_PRIVATE_KEY',
      'JWT_PUBLIC_KEY',
      'S3_SECRET_KEY',
      'S3_ACCESS_KEY',
      'META_APP_SECRET',
      'META_WEBHOOK_VERIFY_TOKEN',
    ]) {
      expect(blueprint).toMatch(new RegExp(`- key: ${key}\\n\\s+sync: false`));
    }
    expect(blueprint).not.toMatch(/BEGIN (RSA )?PRIVATE KEY/);
    expect(blueprint).toMatch(/- key: INTEGRATION_ENCRYPTION_KEY\n\s+generateValue: true/);
  });

  it('runs migrations as a release step, before traffic, and checks readiness', () => {
    expect(blueprint).toMatch(/preDeployCommand: .*prisma migrate deploy/);
    expect(blueprint).toMatch(/healthCheckPath: \/api\/v1\/health\/ready/);
  });

  it('deploys only after CI passes (Requirement 53.8)', () => {
    expect(blueprint.match(/autoDeployTrigger: checksPass/g)).toHaveLength(2);
  });

  it('is a testing environment: not production, no public signup, no production seeding', () => {
    expect(blueprint).toMatch(/- key: APP_ENV\n\s+value: testing/);
    expect(blueprint).toMatch(/- key: ALLOW_PUBLIC_SIGNUP\n\s+value: ["']false["']/);
    expect(blueprint).toMatch(/- key: SEED_ALLOW_PRODUCTION\n\s+value: ["']false["']/);
    expect(blueprint).toMatch(/- key: WORKERS_IN_PROCESS\n\s+value: ["']true["']/);
  });

  it('provides a PostgreSQL database wired into the API', () => {
    expect(blueprint).toMatch(/databases:\n\s+- name: bms-db/);
    expect(blueprint).toMatch(
      /- key: DATABASE_URL\n\s+fromDatabase:\n\s+name: bms-db\n\s+property: connectionString/,
    );
  });
});
