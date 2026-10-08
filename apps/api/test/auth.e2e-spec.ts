import type { INestApplication } from '@nestjs/common';
import { ALL_PERMISSIONS } from '@bms/types';
import { Clock } from '../src/modules/auth/clock';
import { AuthService } from '../src/modules/auth/auth.service';
import { MembershipCache } from '../src/modules/auth/membership-cache';
import { PasswordService } from '../src/modules/auth/password.service';
import { TokenService } from '../src/modules/auth/token.service';
import { api, bearerPayload, createTestApp, seedUser, type TestApp } from './helpers/auth-app';

describe('Authentication (real PostgreSQL)', () => {
  let t: TestApp;
  let app: INestApplication;
  let http: ReturnType<typeof api>;
  let passwords: PasswordService;
  let clock: Clock;
  let tokens: TokenService;
  let cache: MembershipCache;
  let auth: AuthService;
  const realNow = Clock.prototype.now;
  const advance = (ms: number) => {
    const base = Date.now();
    clock.now = () => new Date(base + ms);
  };

  beforeAll(async () => {
    t = await createTestApp();
    app = t.app;
    http = api(app);
    passwords = app.get(PasswordService);
    clock = app.get(Clock);
    tokens = app.get(TokenService);
    cache = app.get(MembershipCache);
    auth = app.get(AuthService);
  }, 90_000);
  afterAll(() => t.close());
  afterEach(() => {
    clock.now = realNow;
  });

  const login = (email: string, password: string) => http.post('/auth/login', { email, password });

  describe('login', () => {
    it('issues an RS256 access token with the designed claims and a hashed refresh session', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_login', {
        permissions: ['audit:view', 'bogus:perm'],
      });
      const res = await login(u.email, u.password).expect(200);
      const data = res.body.data;
      expect(data.requiresWorkspaceSelection).toBe(false);
      const claims = bearerPayload(data.accessToken);
      expect(claims).toMatchObject({
        sub: u.userId,
        tenantId: 'ws_login',
        mid: u.membershipId,
        pv: 1,
      });
      expect(claims.permissions).toEqual(['audit:view']); // unknown permissions are dropped
      expect(typeof claims.fam).toBe('string');
      expect((claims.exp as number) - (claims.iat as number)).toBe(900);
      expect(data.expiresIn).toBe(900);

      const [session] = await t.db.prisma.userSession.findMany({ where: { userId: u.userId } });
      expect(session?.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(session?.refreshTokenHash).not.toBe(data.refreshToken);
      expect(session?.workspaceId).toBe('ws_login');
    });

    it('stores passwords only as argon2id hashes', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_login');
      const user = await t.db.prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).not.toContain(u.password);
    });

    it('gives the same answer for a wrong password and an unknown account', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_login');
      const wrong = await login(u.email, 'not-the-password').expect(401);
      const unknown = await login('nobody@example.test', 'not-the-password').expect(401);
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
      expect({ ...wrong.body, requestId: 0 }).toEqual({ ...unknown.body, requestId: 0 });
    });

    it('refuses inactive users and users without a workspace', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_login');
      await t.db.prisma.user.update({ where: { id: u.userId }, data: { status: 'INACTIVE' } });
      await login(u.email, u.password).expect(401);

      const bare = await t.db.prisma.user.create({
        data: {
          email: 'bare@example.test',
          firstName: 'B',
          lastName: 'B',
          status: 'ACTIVE',
          passwordHash: await passwords.hash('correct-horse-battery'),
        },
      });
      expect(bare.id).toBeTruthy();
      await login('bare@example.test', 'correct-horse-battery').expect(403);
    });

    it('audits successful and failed logins with IP and user agent', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_audit_login');
      await login(u.email, 'wrong-password-123').expect(401);
      await http
        .post('/auth/login', { email: u.email, password: u.password })
        .set('User-Agent', 'jest-agent')
        .expect(200);
      const events = await t.db.prisma.auditEvent.findMany({
        where: { workspaceId: 'ws_audit_login', entityId: u.userId },
        orderBy: { createdAt: 'asc' },
      });
      expect(events.map((e) => e.action)).toEqual(['auth.login_failed', 'auth.login']);
      expect(events[1]?.ipAddress).toBeTruthy();
      expect(events[1]?.userAgent).toBe('jest-agent');
    });
  });

  describe('lockout (Requirement 45.4)', () => {
    it('locks the account for 15 minutes after five failures, audits it, and unlocks afterwards', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_lock');
      for (let i = 0; i < 5; i++) await login(u.email, 'wrong-password-123').expect(401);

      const locked = await login(u.email, u.password).expect(401);
      expect(locked.body.code).toBe('ACCOUNT_LOCKED');
      const lockEvents = await t.db.prisma.auditEvent.count({
        where: { workspaceId: 'ws_lock', action: 'auth.account_locked', entityId: u.userId },
      });
      expect(lockEvents).toBe(1);

      advance(16 * 60_000);
      await login(u.email, u.password).expect(200);
    });

    it('does not lock after four failures, and a success resets the count', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_lock');
      for (let i = 0; i < 4; i++) await login(u.email, 'wrong-password-123').expect(401);
      await login(u.email, u.password).expect(200);
      for (let i = 0; i < 4; i++) await login(u.email, 'wrong-password-123').expect(401);
      await login(u.email, u.password).expect(200);
    });
  });

  describe('workspace selection (Requirement 45.6)', () => {
    it('offers a choice when the user belongs to several workspaces and scopes the token to one', async () => {
      const first = await seedUser(t.db.prisma, passwords, 'ws_multi_a', {
        permissions: ['audit:view'],
      });
      await seedUser(t.db.prisma, passwords, 'ws_multi_b', { email: first.email, permissions: [] });

      const res = await login(first.email, first.password).expect(200);
      expect(res.body.data.requiresWorkspaceSelection).toBe(true);
      expect(res.body.data.workspaces.map((w: { id: string }) => w.id).sort()).toEqual([
        'ws_multi_a',
        'ws_multi_b',
      ]);
      expect(res.body.data.accessToken).toBeUndefined();

      const picked = await http
        .post('/auth/select-workspace', {
          loginTicket: res.body.data.loginTicket,
          workspaceId: 'ws_multi_b',
        })
        .expect(200);
      expect(bearerPayload(picked.body.data.accessToken).tenantId).toBe('ws_multi_b');

      await http
        .post('/auth/select-workspace', {
          loginTicket: res.body.data.loginTicket,
          workspaceId: 'ws_other',
        })
        .expect(403);
      await http
        .post('/auth/select-workspace', { loginTicket: 'garbage', workspaceId: 'ws_multi_a' })
        .expect(401);
    });

    it('does not accept a login ticket as an access token', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_ticket');
      await seedUser(t.db.prisma, passwords, 'ws_ticket_2', { email: u.email });
      const res = await login(u.email, u.password).expect(200);
      await http.get('/auth/me', res.body.data.loginTicket).expect(401);
    });

    it('switches workspace with a new session; the old token stays bound to its workspace', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_sw_a');
      await seedUser(t.db.prisma, passwords, 'ws_sw_b', { email: u.email });
      const ticket = (await login(u.email, u.password)).body.data.loginTicket;
      const a = (
        await http.post('/auth/select-workspace', { loginTicket: ticket, workspaceId: 'ws_sw_a' })
      ).body.data;
      const b = await http
        .post('/auth/switch-workspace', { workspaceId: 'ws_sw_b' }, a.accessToken)
        .expect(200);
      expect(bearerPayload(b.body.data.accessToken).tenantId).toBe('ws_sw_b');
      expect(bearerPayload(a.accessToken).tenantId).toBe('ws_sw_a');
      await http
        .post('/auth/switch-workspace', { workspaceId: 'ws_nope' }, a.accessToken)
        .expect(403);
    });
  });

  describe('refresh tokens (Requirements 2.2, 2.3)', () => {
    const start = async (ws = 'ws_refresh') => {
      const u = await seedUser(t.db.prisma, passwords, ws);
      const data = (await login(u.email, u.password)).body.data;
      return { u, ...data };
    };

    it('rotates: a refresh returns a new pair in the same family', async () => {
      const s = await start();
      const res = await http.post('/auth/refresh', { refreshToken: s.refreshToken }).expect(200);
      expect(res.body.data.refreshToken).not.toBe(s.refreshToken);
      expect(bearerPayload(res.body.data.accessToken).fam).toBe(bearerPayload(s.accessToken).fam);
      await http.get('/auth/me', res.body.data.accessToken).expect(200);
    });

    it('detects reuse of a rotated token, revokes the whole family and audits it', async () => {
      const s = await start('ws_reuse');
      const next = (await http.post('/auth/refresh', { refreshToken: s.refreshToken }).expect(200))
        .body.data;

      await http.post('/auth/refresh', { refreshToken: s.refreshToken }).expect(401); // reuse
      await http.post('/auth/refresh', { refreshToken: next.refreshToken }).expect(401); // family is dead

      const events = await t.db.prisma.auditEvent.count({
        where: { workspaceId: 'ws_reuse', action: 'auth.refresh_token_reuse' },
      });
      expect(events).toBe(1);
    });

    it('rejects unknown, expired and revoked refresh tokens', async () => {
      await http.post('/auth/refresh', { refreshToken: 'unknown-token' }).expect(401);

      const s = await start('ws_expired');
      advance(31 * 24 * 3600_000);
      await http.post('/auth/refresh', { refreshToken: s.refreshToken }).expect(401);
      clock.now = realNow;

      const r = await start('ws_revoked');
      await http.post('/auth/logout', {}, r.accessToken).expect(204);
      await http.post('/auth/refresh', { refreshToken: r.refreshToken }).expect(401);
    });

    it('refuses to refresh once the membership was deactivated', async () => {
      const s = await start('ws_deact');
      await t.db.prisma.userWorkspace.update({
        where: { id: s.u.membershipId },
        data: { status: 'INACTIVE' },
      });
      await http.post('/auth/refresh', { refreshToken: s.refreshToken }).expect(401);
    });
  });

  describe('access tokens', () => {
    it('rejects missing, malformed and expired tokens with the right codes', async () => {
      await http.get('/auth/me').expect(401);
      const bad = await http.get('/auth/me', 'not.a.jwt').expect(401);
      expect(bad.body.code).toBe('UNAUTHENTICATED');

      const u = await seedUser(t.db.prisma, passwords, 'ws_exp');
      const expired = tokens.signAccessToken(
        {
          sub: u.userId,
          tenantId: 'ws_exp',
          mid: u.membershipId,
          permissions: [],
          pv: 1,
          fam: 'f',
        },
        { iat: Math.floor(Date.now() / 1000) - 3600, exp: Math.floor(Date.now() / 1000) - 1800 },
      );
      const res = await http.get('/auth/me', expired).expect(401);
      expect(res.body.code).toBe('TOKEN_EXPIRED');
    });

    it('rejects a token signed by another key', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_forge');
      const good = tokens.signAccessToken({
        sub: u.userId,
        tenantId: 'ws_forge',
        mid: u.membershipId,
        permissions: [],
        pv: 1,
        fam: 'f',
      });
      const [h, p] = good.split('.');
      await http.get('/auth/me', `${h}.${p}.${'A'.repeat(342)}`).expect(401);
    });

    it('returns TOKEN_STALE after a permission change, immediately in-process and within 30 seconds otherwise (Requirement 45.7)', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_stale', { permissions: ['audit:view'] });
      const { accessToken } = (await login(u.email, u.password)).body.data;
      await http.get('/auth/me', accessToken).expect(200);

      await t.db.prisma.userWorkspace.update({
        where: { id: u.membershipId },
        data: { permVersion: { increment: 1 } },
      });
      await http.get('/auth/me', accessToken).expect(200); // still inside the 30 s cache window
      cache.invalidate(u.membershipId);
      const res = await http.get('/auth/me', accessToken).expect(401);
      expect(res.body.code).toBe('TOKEN_STALE');

      // Without an explicit invalidation the cache expires by itself within 30 seconds.
      const v = await seedUser(t.db.prisma, passwords, 'ws_stale2');
      const second = (await login(v.email, v.password)).body.data.accessToken;
      await http.get('/auth/me', second).expect(200);
      await t.db.prisma.userWorkspace.update({
        where: { id: v.membershipId },
        data: { permVersion: { increment: 1 } },
      });
      advance(31_000);
      expect((await http.get('/auth/me', second).expect(401)).body.code).toBe('TOKEN_STALE');
    });

    it('a deactivated membership is rejected on the next request', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_off');
      const { accessToken } = (await login(u.email, u.password)).body.data;
      await t.db.prisma.userWorkspace.update({
        where: { id: u.membershipId },
        data: { status: 'INACTIVE', permVersion: { increment: 1 } },
      });
      cache.invalidate();
      await http.get('/auth/me', accessToken).expect(401);
    });

    it('keeps the Owner token small enough for a cookie', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_owner', { isOwner: true });
      const { accessToken } = (await login(u.email, u.password)).body.data;
      const permissions = bearerPayload(accessToken).permissions as string[];
      expect(permissions).toHaveLength(ALL_PERMISSIONS.length - 1); // everything except platform:admin
      expect(permissions).not.toContain('platform:admin');
      expect(accessToken.length).toBeLessThan(3800);
    });
  });

  describe('profile and sessions', () => {
    it('returns the profile with workspace, roles, permissions, terminology and modules', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_me', {
        permissions: ['audit:view'],
        roleName: 'Auditor',
      });
      await t.db.prisma.workspace.update({
        where: { id: 'ws_me' },
        data: {
          config: {
            terminology: { customer: { singular: 'Guest', plural: 'Guests' } },
            modules: { pos: true },
          },
        },
      });
      const { accessToken } = (await login(u.email, u.password)).body.data;
      const me = (await http.get('/auth/me', accessToken).expect(200)).body.data;
      expect(me).toMatchObject({
        user: { id: u.userId, email: u.email },
        workspace: { id: 'ws_me' },
        roles: ['Auditor'],
        permissions: ['audit:view'],
        terminology: { customer: { singular: 'Guest' } },
        modules: { pos: true },
      });
      expect(JSON.stringify(me)).not.toContain('passwordHash');
    });

    it('lists active sessions, marks the current one and revokes another', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_sessions');
      const one = (await login(u.email, u.password)).body.data;
      const two = (await login(u.email, u.password)).body.data;
      const list = (await http.get('/auth/sessions', one.accessToken).expect(200)).body
        .data as Array<{ id: string; isCurrent: boolean }>;
      expect(list).toHaveLength(2);
      expect(list.filter((s) => s.isCurrent)).toHaveLength(1);

      const other = list.find((s) => !s.isCurrent) as { id: string };
      await http.del(`/auth/sessions/${other.id}`, one.accessToken).expect(204);
      await http.post('/auth/refresh', { refreshToken: two.refreshToken }).expect(401);
      expect((await http.get('/auth/sessions', one.accessToken)).body.data).toHaveLength(1);
      await http.del('/auth/sessions/does-not-exist', one.accessToken).expect(404);
    });

    it('cannot revoke another users session', async () => {
      const a = await seedUser(t.db.prisma, passwords, 'ws_sess_a');
      const b = await seedUser(t.db.prisma, passwords, 'ws_sess_b');
      const tokenA = (await login(a.email, a.password)).body.data.accessToken;
      const tokenB = (await login(b.email, b.password)).body.data.accessToken;
      const bSession = (await http.get('/auth/sessions', tokenB)).body.data[0].id;
      await http.del(`/auth/sessions/${bSession}`, tokenA).expect(404);
    });
  });

  describe('passwords (Requirements 45.1, 45.2, 45.5)', () => {
    it('changes the password, ends other sessions and keeps the current one', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_pw');
      const current = (await login(u.email, u.password)).body.data;
      const other = (await login(u.email, u.password)).body.data;

      await http
        .post(
          '/auth/password/change',
          { currentPassword: 'wrong', newPassword: 'a-new-password-1' },
          current.accessToken,
        )
        .expect(400);
      const weak = await http
        .post(
          '/auth/password/change',
          { currentPassword: u.password, newPassword: 'short' },
          current.accessToken,
        )
        .expect(400);
      expect(weak.body.details.password).toBeDefined();
      const sameAsEmail = await http
        .post(
          '/auth/password/change',
          { currentPassword: u.password, newPassword: u.email },
          current.accessToken,
        )
        .expect(400);
      expect(sameAsEmail.body.code).toBe('VALIDATION_FAILED');

      await http
        .post(
          '/auth/password/change',
          { currentPassword: u.password, newPassword: 'a-new-password-1' },
          current.accessToken,
        )
        .expect(204);
      await http.post('/auth/refresh', { refreshToken: other.refreshToken }).expect(401);
      await http.post('/auth/refresh', { refreshToken: current.refreshToken }).expect(200);
      await login(u.email, u.password).expect(401);
      await login(u.email, 'a-new-password-1').expect(200);
    });

    it('answers "forgot password" identically for known and unknown accounts', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_forgot');
      const known = await http.post('/auth/password/forgot', { email: u.email }).expect(202);
      const unknown = await http
        .post('/auth/password/forgot', { email: 'ghost@example.test' })
        .expect(202);
      expect({ ...known.body, requestId: 0 }).toEqual({ ...unknown.body, requestId: 0 });
      expect(await t.db.prisma.passwordResetToken.count({ where: { userId: u.userId } })).toBe(1);
    });

    it('resets with a single-use token valid for 60 minutes and ends every session', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_reset');
      const session = (await login(u.email, u.password)).body.data;

      const token = await auth.createResetToken(u.userId);
      const stored = await t.db.prisma.passwordResetToken.findFirstOrThrow({
        where: { userId: u.userId },
      });
      expect(stored.tokenHash).not.toBe(token);
      expect(
        Math.abs(stored.expiresAt.getTime() - stored.createdAt.getTime() - 60 * 60_000),
      ).toBeLessThan(1000);

      await http.post('/auth/password/reset', { token, newPassword: 'short' }).expect(400);
      await http
        .post('/auth/password/reset', { token, newPassword: 'brand-new-password' })
        .expect(204);
      await http
        .post('/auth/password/reset', { token, newPassword: 'another-new-password' })
        .expect(400); // single use

      await http.post('/auth/refresh', { refreshToken: session.refreshToken }).expect(401);
      await login(u.email, 'brand-new-password').expect(200);
    });

    it('rejects an expired or unknown reset token and a reset clears a lockout', async () => {
      const u = await seedUser(t.db.prisma, passwords, 'ws_reset2');
      const token = await auth.createResetToken(u.userId);
      advance(61 * 60_000);
      await http
        .post('/auth/password/reset', { token, newPassword: 'brand-new-password' })
        .expect(400);
      clock.now = realNow;
      await http
        .post('/auth/password/reset', { token: 'unknown', newPassword: 'brand-new-password' })
        .expect(400);

      for (let i = 0; i < 5; i++) await login(u.email, 'wrong-password-123').expect(401);
      const fresh = await auth.createResetToken(u.userId);
      await http
        .post('/auth/password/reset', { token: fresh, newPassword: 'brand-new-password' })
        .expect(204);
      await login(u.email, 'brand-new-password').expect(200);
    });
  });
});
