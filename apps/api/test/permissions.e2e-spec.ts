import type { INestApplication } from '@nestjs/common';
import fc from 'fast-check';
import { ALL_PERMISSIONS } from '@bms/types';
import request from 'supertest';
import { AuditService } from '../src/modules/audit/audit.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { TokenService } from '../src/modules/auth/token.service';
import { createTestApp, seedUser, type SeededUser, type TestApp } from './helpers/auth-app';
import { listRoutes, type RouteInfo } from './helpers/routes';

/** Routes that are reachable without a token. Adding one is a deliberate act: it must be listed here. */
const PUBLIC_ROUTES = [
  'GET /api/v1/health/live',
  'GET /api/v1/health/ready',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/select-workspace',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/password/forgot',
  'POST /api/v1/auth/password/reset',
  'POST /api/v1/tenants',
  'GET /api/v1/files/local',
  'POST /api/v1/auth/invite/accept',
];

/** Routes that need a session but no specific permission (self-service). Also listed deliberately. */
const AUTHENTICATED_ONLY_ROUTES = [
  'POST /api/v1/auth/switch-workspace',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/password/change',
  'GET /api/v1/auth/me',
  'GET /api/v1/auth/sessions',
  'POST /api/v1/files',
  'GET /api/v1/files/:id/url',
  'DELETE /api/v1/files/:id',
  'GET /api/v1/settings/units',
  'GET /api/v1/settings/tax-classes',
  'GET /api/v1/settings/lost-reasons',
  'GET /api/v1/fields',
  'DELETE /api/v1/auth/sessions/:id',
];

const label = (r: RouteInfo) => `${r.method} ${r.path}`;
const concrete = (r: RouteInfo) => r.path.replace(/:\w+/g, 'x');

describe('Route protection (real PostgreSQL)', () => {
  let t: TestApp;
  let app: INestApplication;
  let routes: RouteInfo[];
  let tokens: TokenService;
  let user: SeededUser;

  const mint = (permissions: string[]) =>
    tokens.signAccessToken({
      sub: user.userId,
      tenantId: 'ws_perm',
      mid: user.membershipId,
      permissions,
      pv: 1,
      fam: 'fam_test',
    });

  const call = (r: RouteInfo, token?: string) => {
    const req = (
      request(app.getHttpServer()) as unknown as Record<string, (p: string) => request.Test>
    )[r.method.toLowerCase()]!(concrete(r));
    req.set(
      'X-Forwarded-For',
      `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    );
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send({});
  };

  beforeAll(async () => {
    t = await createTestApp();
    app = t.app;
    routes = listRoutes(app);
    tokens = app.get(TokenService);
    user = await seedUser(t.db.prisma, app.get(PasswordService), 'ws_perm');
    app.get(AuditService).sleep = async () => undefined;
  }, 90_000);
  afterAll(() => t.close());

  it('finds the routes it is supposed to protect', () => {
    expect(routes.length).toBeGreaterThanOrEqual(
      PUBLIC_ROUTES.length + AUTHENTICATED_ONLY_ROUTES.length + 1,
    );
  });

  it('route scan: every route is public, authenticated-only or names a permission from the catalogue', () => {
    const offenders = routes.filter(
      (r) =>
        !r.isPublic &&
        !r.authenticatedOnly &&
        !(r.permission && (ALL_PERMISSIONS as readonly string[]).includes(r.permission)),
    );
    expect(offenders.map(label)).toEqual([]);
  });

  it('route scan: the set of public routes and of authenticated-only routes is exactly the reviewed list', () => {
    expect(
      routes
        .filter((r) => r.isPublic)
        .map(label)
        .sort(),
    ).toEqual([...PUBLIC_ROUTES].sort());
    expect(
      routes
        .filter((r) => !r.isPublic && r.authenticatedOnly)
        .map(label)
        .sort(),
    ).toEqual([...AUTHENTICATED_ONLY_ROUTES].sort());
  });

  it('answers 401 to every non-public route without a valid token', async () => {
    for (const r of routes.filter((x) => !x.isPublic)) {
      const none = await call(r);
      expect([label(r), none.status]).toEqual([label(r), 401]);
      const garbage = await call(r, 'garbage');
      expect([label(r), garbage.status]).toEqual([label(r), 401]);
    }
  });

  it('Property 2 — a token lacking the required permission gets 403 on every permission-guarded route (100+ cases)', async () => {
    const guarded = routes.filter((r) => r.permission);
    expect(guarded.length).toBeGreaterThan(0);
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...guarded),
        fc.subarray([...ALL_PERMISSIONS], { minLength: 0 }),
        async (route, subset) => {
          const without = subset.filter((p) => p !== route.permission);
          const res = await call(route, mint(without));
          expect([label(route), res.status, res.body.code]).toEqual([
            label(route),
            403,
            'PERMISSION_DENIED',
          ]);
          // The refusal is audited with the user and the attempted permission (Requirement 2.6).
        },
      ),
      { numRuns: 120 },
    );
    const denials = await t.db.prisma.auditEvent.count({
      where: { workspaceId: 'ws_perm', action: 'auth.permission_denied', actorUserId: user.userId },
    });
    expect(denials).toBeGreaterThan(0);
  }, 120_000);

  it('a token that has the required permission passes the guard', async () => {
    for (const route of routes.filter((r) => r.permission)) {
      const res = await call(route, mint([route.permission as string]));
      expect([label(route), res.status === 403 || res.status === 401]).toEqual([
        label(route),
        false,
      ]);
    }
  });

  it('a permission from the token is not enough when the membership is no longer current', async () => {
    const guarded = routes.find((r) => r.permission) as RouteInfo;
    const stale = tokens.signAccessToken({
      sub: user.userId,
      tenantId: 'ws_perm',
      mid: user.membershipId,
      permissions: [guarded.permission as string],
      pv: 999,
      fam: 'fam_test',
    });
    const res = await call(guarded, stale);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_STALE');
  });
});
