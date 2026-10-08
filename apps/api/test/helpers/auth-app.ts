import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { ENV, type Env } from '../../src/config/env';
import { PasswordService } from '../../src/modules/auth/password.service';
import { createTestDatabase, type TestDatabase } from './test-db';
import { ensureWorkspace } from './tenant-factories';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

export const testEnv = (): Env =>
  ({
    NODE_ENV: 'test',
    APP_ENV: 'development',
    DATABASE_URL: 'unused',
    REDIS_URL: 'redis://localhost:6379',
    JWT_PRIVATE_KEY: privateKey,
    JWT_PUBLIC_KEY: publicKey,
    ACCESS_TOKEN_TTL: '15m',
    REFRESH_TOKEN_TTL: '30d',
    INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    STORAGE_DRIVER: 'local',
    MAX_UPLOAD_MB: 10,
    WEB_ORIGIN: 'http://localhost:3000',
    API_BASE_URL: 'http://localhost:4000',
    WORKERS_IN_PROCESS: true,
    META_APP_SECRET: 'x',
    META_WEBHOOK_VERIFY_TOKEN: 'x',
    ALLOW_PUBLIC_SIGNUP: false,
    PLATFORM_AUTOMATION_ENABLED: false,
    SEED_ALLOW_PRODUCTION: false,
  }) as Env;

export interface TestApp {
  app: INestApplication;
  db: TestDatabase;
  close(): Promise<void>;
}

/** Boots the real AppModule against a fresh database. */
export async function createTestApp(): Promise<TestApp> {
  const db = await createTestDatabase();
  process.env.DATABASE_URL = db.url;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(testEnv())
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, { APP_ENV: 'development', WEB_ORIGIN: 'http://localhost:3000' });
  // Tests give every request its own client address so rate limits do not couple test cases.
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  await app.init();
  return {
    app,
    db,
    async close() {
      await app.close();
      await db.drop();
    },
  };
}

let counter = 0;
const uniqueIp = (): string =>
  `10.${(counter >> 16) & 255}.${(counter >> 8) & 255}.${counter++ & 255}`;

/** supertest helper: JSON request from a fresh client address, optionally authenticated. */
export function api(app: INestApplication) {
  const call = (
    method: 'get' | 'post' | 'delete' | 'patch',
    path: string,
    token?: string,
    body?: object,
    ip?: string,
  ) => {
    const agent = request(app.getHttpServer());
    const req = agent[method](`/api/v1${path}`).set('X-Forwarded-For', ip ?? uniqueIp());
    if (token) req.set('Authorization', `Bearer ${token}`);
    return body ? req.send(body) : req;
  };
  return {
    get: (path: string, token?: string) => call('get', path, token),
    post: (path: string, body?: object, token?: string, ip?: string) =>
      call('post', path, token, body ?? {}, ip),
    del: (path: string, token?: string) => call('delete', path, token),
  };
}

export interface SeededUser {
  userId: string;
  membershipId: string;
  roleId: string;
  email: string;
  password: string;
}

export async function seedUser(
  prisma: PrismaClient,
  passwords: PasswordService,
  workspaceId: string,
  options: {
    email?: string;
    password?: string;
    permissions?: string[];
    isOwner?: boolean;
    roleName?: string;
    userId?: string;
  } = {},
): Promise<SeededUser> {
  await ensureWorkspace(prisma, workspaceId);
  const email = options.email ?? `user_${randomBytes(4).toString('hex')}@example.test`;
  const password = options.password ?? 'correct-horse-battery';
  const user =
    (await prisma.user.findUnique({ where: { email } })) ??
    (await prisma.user.create({
      data: {
        email,
        firstName: 'Test',
        lastName: 'User',
        status: 'ACTIVE',
        passwordHash: await passwords.hash(password),
      },
    }));
  const role = await prisma.role.create({
    data: {
      workspaceId,
      name: options.roleName ?? `role_${randomBytes(4).toString('hex')}`,
      permissions: options.permissions ?? [],
      isOwner: options.isOwner ?? false,
    },
  });
  const membership = await prisma.userWorkspace.create({ data: { workspaceId, userId: user.id } });
  await prisma.userWorkspaceRole.create({
    data: { workspaceId, userWorkspaceId: membership.id, roleId: role.id },
  });
  return { userId: user.id, membershipId: membership.id, roleId: role.id, email, password };
}

export function bearerPayload(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.split('.')[1] as string, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}
