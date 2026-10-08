import { DEFAULT_ROLES } from '@bms/types';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import {
  DEMO_WORKSPACE,
  SeedRefusedError,
  assertSeedAllowed,
  runDemoSeed,
} from '../src/seed/demo-seed';
import { DEMO_STEPS } from '../src/seed/steps';
import { DEMO_STAFF } from '../src/seed/steps/staff.step';
import { api, bearerPayload, createTestApp, type TestApp } from './helpers/auth-app';

describe('seed:demo (Requirements 50.2, 50.3)', () => {
  let t: TestApp;
  const services = () => ({
    prisma: t.app.get(PrismaService),
    tenants: t.app.get(TenantsService),
    passwords: t.app.get(PasswordService),
  });

  beforeAll(async () => {
    t = await createTestApp();
  }, 90_000);
  afterAll(() => t.close());

  it('creates the demo business on the furniture profile with one sign-in per default role', async () => {
    const logs: string[] = [];
    const report = await runDemoSeed(services(), DEMO_STEPS, {
      password: 'demo-password-1',
      log: (m) => logs.push(m),
    });
    expect(report.steps).toEqual([
      { name: 'workspace', created: 1, existing: 0 },
      { name: 'staff', created: 8, existing: 0 },
    ]);
    expect(logs).toHaveLength(2);

    const workspace = await t.db.prisma.workspace.findUniqueOrThrow({
      where: { id: report.workspaceId },
    });
    expect(workspace).toMatchObject({
      name: DEMO_WORKSPACE.name,
      slug: DEMO_WORKSPACE.slug,
      industryProfile: 'furniture',
      isDemo: true,
    });

    const members = await t.db.prisma.userWorkspace.findMany({
      where: { workspaceId: report.workspaceId },
      include: { user: true, roles: { include: { role: true } } },
    });
    expect(members).toHaveLength(9);
    expect(
      members
        .map((m) => m.roles.map((r) => r.role.name))
        .flat()
        .sort(),
    ).toEqual(DEFAULT_ROLES.map((r) => r.name).sort());
    expect(
      members.every((m) => m.user.email.endsWith('@demo.test') && m.user.status === 'ACTIVE'),
    ).toBe(true);
    expect(
      members
        .filter((m) => m.isSalesperson)
        .map((m) => m.user.email)
        .sort(),
    ).toEqual(['cashier@demo.test', 'salesperson@demo.test']);
  });

  it('is safe to run again: nothing is duplicated and passwords are untouched', async () => {
    const before = await t.db.prisma.user.findMany({
      where: { email: { endsWith: '@demo.test' } },
      orderBy: { email: 'asc' },
    });
    const report = await runDemoSeed(services(), DEMO_STEPS, { password: 'a-different-password' });
    expect(report.steps).toEqual([
      { name: 'workspace', created: 0, existing: 1 },
      { name: 'staff', created: 0, existing: 8 },
    ]);
    const after = await t.db.prisma.user.findMany({
      where: { email: { endsWith: '@demo.test' } },
      orderBy: { email: 'asc' },
    });
    expect(after.map((u) => u.passwordHash)).toEqual(before.map((u) => u.passwordHash));
    expect(await t.db.prisma.workspace.count({ where: { isDemo: true } })).toBe(1);
    expect(await t.db.prisma.userWorkspaceRole.count()).toBe(9);
  });

  it('restores a missing staff member on a later run', async () => {
    const user = await t.db.prisma.user.findUniqueOrThrow({
      where: { email: DEMO_STAFF[0]!.email },
    });
    await t.db.prisma.userWorkspaceRole.deleteMany({
      where: { userWorkspace: { userId: user.id } },
    });
    const report = await runDemoSeed(services(), DEMO_STEPS, { password: 'x-password-123' });
    expect(report.steps[1]).toEqual({ name: 'staff', created: 0, existing: 8 });
    expect(
      await t.db.prisma.userWorkspaceRole.count({ where: { userWorkspace: { userId: user.id } } }),
    ).toBe(1);
  });

  it('every demo user can sign in and sees only what their role allows', async () => {
    const http = api(t.app);
    const permissionsOf = async (email: string) => {
      const res = await http
        .post('/auth/login', { email, password: 'demo-password-1' })
        .expect(200);
      return bearerPayload(res.body.data.accessToken).permissions as string[];
    };
    const owner = await permissionsOf('owner@demo.test');
    const cashier = await permissionsOf('cashier@demo.test');
    const viewer = await permissionsOf('viewer@demo.test');
    expect(owner).toContain('role:configure');
    expect(cashier).toContain('pos:sell');
    expect(cashier).not.toContain('role:configure');
    expect(cashier).not.toContain('payment:void');
    expect(viewer.every((p) => p.endsWith(':view'))).toBe(true);
    for (const person of DEMO_STAFF) await permissionsOf(person.email);
  });

  it('can give every demo user a new password on request', async () => {
    await runDemoSeed(services(), DEMO_STEPS, {
      password: 'fresh-password-9',
      resetPasswords: true,
    });
    const http = api(t.app);
    await http
      .post('/auth/login', { email: 'manager@demo.test', password: 'demo-password-1' })
      .expect(401);
    await http
      .post('/auth/login', { email: 'manager@demo.test', password: 'fresh-password-9' })
      .expect(200);
    await http
      .post('/auth/login', { email: 'owner@demo.test', password: 'fresh-password-9' })
      .expect(200);
  });

  it('runs steps in order and passes the workspace on', async () => {
    const seen: string[] = [];
    const report = await runDemoSeed(
      services(),
      [
        ...DEMO_STEPS,
        {
          name: 'probe',
          run: async (ctx) => (seen.push(ctx.workspaceId), { created: 0, existing: 1 }),
        },
      ],
      { password: 'x-password-123' },
    );
    expect(seen).toEqual([report.workspaceId]);
    expect(report.steps.map((s) => s.name)).toEqual(['workspace', 'staff', 'probe']);
  });
});

describe('assertSeedAllowed', () => {
  it('refuses production unless explicitly overridden', () => {
    expect(() =>
      assertSeedAllowed({ APP_ENV: 'production', SEED_ALLOW_PRODUCTION: false }),
    ).toThrow(SeedRefusedError);
    expect(() =>
      assertSeedAllowed({ APP_ENV: 'production', SEED_ALLOW_PRODUCTION: true }),
    ).not.toThrow();
    expect(() =>
      assertSeedAllowed({ APP_ENV: 'testing', SEED_ALLOW_PRODUCTION: false }),
    ).not.toThrow();
    expect(() =>
      assertSeedAllowed({ APP_ENV: 'development', SEED_ALLOW_PRODUCTION: false }),
    ).not.toThrow();
  });

  it('says what to do', () => {
    expect(() =>
      assertSeedAllowed({ APP_ENV: 'production', SEED_ALLOW_PRODUCTION: false }),
    ).toThrow(/SEED_ALLOW_PRODUCTION/);
  });
});
