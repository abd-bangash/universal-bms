import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_PERMISSIONS } from '@bms/types';
import { Clock } from '../src/modules/auth/clock';
import { PasswordService } from '../src/modules/auth/password.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, bearerPayload, createTestApp, seedUser, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Users, invitations and roles (real PostgreSQL)', () => {
  let t: TestApp;
  let app: INestApplication;
  let http: ReturnType<typeof api>;
  let tenants: TenantsService;
  let clock: Clock;
  const realNow = Clock.prototype.now;

  beforeAll(async () => {
    t = await createTestApp();
    app = t.app;
    http = api(app);
    tenants = app.get(TenantsService);
    clock = app.get(Clock);
  }, 90_000);
  afterAll(() => t.close());
  afterEach(() => {
    clock.now = realNow;
  });

  const prisma = () => t.db.prisma;
  let n = 0;

  /** A fresh business with its Owner logged in. */
  async function business(name = `Biz ${++n}`) {
    const email = `owner${n}@biz.test`;
    const created = await tenants.createWorkspace({
      name,
      industryProfile: 'furniture',
      owner: { email, firstName: 'Olivia', lastName: 'Owner', password: 'owner-password-1' },
    });
    const login = await http
      .post('/auth/login', { email, password: 'owner-password-1' })
      .expect(200);
    const roles = (await http.get('/roles', login.body.data.accessToken).expect(200)).body
      .data as Json[];
    const roleId = (roleName: string) =>
      (roles.find((r) => r.name === roleName) as Json).id as string;
    return { ...created, email, token: login.body.data.accessToken as string, roleId };
  }

  /** Invites and accepts in one go; returns the new member's login token. */
  async function addMember(
    b: Awaited<ReturnType<typeof business>>,
    roleNames: string[],
    email: string,
    password = 'member-password-1',
  ) {
    const invite = await http
      .post('/users/invite', { email, roleIds: roleNames.map(b.roleId) }, b.token)
      .expect(201);
    await http
      .post('/auth/invite/accept', {
        token: invite.body.data.token,
        password,
        firstName: 'Sam',
        lastName: 'Staff',
      })
      .expect(200);
    const login = await http.post('/auth/login', { email, password }).expect(200);
    const me = await http.get('/auth/me', login.body.data.accessToken).expect(200);
    return {
      email,
      password,
      token: login.body.data.accessToken as string,
      refreshToken: login.body.data.refreshToken as string,
      userId: me.body.data.user.id as string,
    };
  }

  describe('invitations (Requirements 3.1, 3.2)', () => {
    it('invites with a 72-hour single-use token; accepting creates the account with the invited roles', async () => {
      const b = await business();
      const invite = await http
        .post(
          '/users/invite',
          { email: 'Cara@Biz.test', roleIds: [b.roleId('Salesperson'), b.roleId('Cashier')] },
          b.token,
        )
        .expect(201);
      expect(invite.body.data.email).toBe('cara@biz.test');
      expect(
        Math.abs(new Date(invite.body.data.expiresAt).getTime() - Date.now() - 72 * 3600_000),
      ).toBeLessThan(5000);

      const stored = await prisma().invitation.findFirstOrThrow({
        where: { workspaceId: b.workspaceId },
      });
      expect(stored.tokenHash).not.toBe(invite.body.data.token);

      const token = invite.body.data.token;
      await http
        .post('/auth/invite/accept', { token, password: 'short', firstName: 'Cara', lastName: 'C' })
        .expect(400);
      await http
        .post('/auth/invite/accept', {
          token,
          password: 'cara-password-1',
          firstName: 'Cara',
          lastName: 'Clark',
        })
        .expect(200);
      await http
        .post('/auth/invite/accept', {
          token,
          password: 'cara-password-1',
          firstName: 'Cara',
          lastName: 'Clark',
        })
        .expect(400); // single use

      const login = await http
        .post('/auth/login', { email: 'cara@biz.test', password: 'cara-password-1' })
        .expect(200);
      const claims = bearerPayload(login.body.data.accessToken);
      expect(claims.tenantId).toBe(b.workspaceId);
      expect(claims.permissions).toEqual(
        expect.arrayContaining(['pos:sell', 'lead:create', 'pos:open_session']),
      );
      expect(claims.permissions).not.toContain('payment:void');
    });

    it('rejects expired, unknown and duplicate invitations', async () => {
      const b = await business();
      const invite = await http
        .post('/users/invite', { email: 'late@biz.test', roleIds: [b.roleId('Viewer')] }, b.token)
        .expect(201);
      clock.now = () => new Date(Date.now() + 73 * 3600_000);
      await http
        .post('/auth/invite/accept', {
          token: invite.body.data.token,
          password: 'late-password-1',
          firstName: 'L',
          lastName: 'L',
        })
        .expect(400);
      clock.now = realNow;
      await http
        .post('/auth/invite/accept', {
          token: 'nope',
          password: 'late-password-1',
          firstName: 'L',
          lastName: 'L',
        })
        .expect(400);

      await http
        .post('/users/invite', { email: b.email, roleIds: [b.roleId('Viewer')] }, b.token)
        .expect(400); // already a member
      await http.post('/users/invite', { email: 'x@biz.test', roleIds: [] }, b.token).expect(400);
      await http
        .post('/users/invite', { email: 'x@biz.test', roleIds: ['missing'] }, b.token)
        .expect(400);
    });

    it('a new invitation replaces an open one for the same address', async () => {
      const b = await business();
      const first = await http
        .post('/users/invite', { email: 'twice@biz.test', roleIds: [b.roleId('Viewer')] }, b.token)
        .expect(201);
      const second = await http
        .post('/users/invite', { email: 'twice@biz.test', roleIds: [b.roleId('Viewer')] }, b.token)
        .expect(201);
      const body = { password: 'twice-password-1', firstName: 'T', lastName: 'T' };
      await http.post('/auth/invite/accept', { token: first.body.data.token, ...body }).expect(400);
      await http
        .post('/auth/invite/accept', { token: second.body.data.token, ...body })
        .expect(200);
    });

    it('lets someone with an account elsewhere join by confirming their password', async () => {
      const a = await business();
      const b = await business();
      const member = await addMember(a, ['Manager'], 'shared@people.test', 'shared-password-1');
      expect(member.userId).toBeTruthy();
      const invite = await http
        .post(
          '/users/invite',
          { email: 'shared@people.test', roleIds: [b.roleId('Viewer')] },
          b.token,
        )
        .expect(201);
      const body = { token: invite.body.data.token, firstName: 'Sam', lastName: 'Staff' };
      await http
        .post('/auth/invite/accept', { ...body, password: 'wrong-password-123' })
        .expect(400);
      await http
        .post('/auth/invite/accept', { ...body, password: 'shared-password-1' })
        .expect(200);
      const login = await http
        .post('/auth/login', { email: 'shared@people.test', password: 'shared-password-1' })
        .expect(200);
      expect(login.body.data.requiresWorkspaceSelection).toBe(true);
      expect(login.body.data.workspaces).toHaveLength(2);
    });

    it('only an Owner can hand out the Owner role', async () => {
      const b = await business();
      const manager = await addMember(b, ['Manager'], 'mgr@biz.test');
      await http
        .post(
          '/users/invite',
          { email: 'boss@biz.test', roleIds: [b.roleId('Owner')] },
          manager.token,
        )
        .expect(403);
      await http
        .post('/users/invite', { email: 'boss@biz.test', roleIds: [b.roleId('Owner')] }, b.token)
        .expect(201);
    });
  });

  describe('staff profiles', () => {
    it('lists, filters and paginates members of this workspace only', async () => {
      const b = await business();
      const other = await business();
      for (let i = 0; i < 4; i++)
        await addMember(b, [i % 2 ? 'Cashier' : 'Salesperson'], `staff${i}@list.test`);
      await addMember(other, ['Cashier'], 'outsider@list.test');

      const all = await http.get('/users?limit=100', b.token).expect(200);
      expect(all.body.data).toHaveLength(5);
      expect(all.body.data.map((u: Json) => u.email)).not.toContain('outsider@list.test');

      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await http
          .get(`/users?limit=2${cursor ? `&cursor=${cursor}` : ''}`, b.token)
          .expect(200);
        seen.push(...page.body.data.map((u: Json) => u.email));
        cursor = page.body.meta.nextCursor;
      } while (cursor);
      expect(seen).toEqual(all.body.data.map((u: Json) => u.email));

      expect((await http.get('/users?q=STAFF2', b.token)).body.data).toHaveLength(1);
      expect(
        (await http.get(`/users?roleId=${b.roleId('Cashier')}`, b.token)).body.data,
      ).toHaveLength(2);
      expect((await http.get('/users?status=INACTIVE', b.token)).body.data).toHaveLength(0);
    });

    it('updates the profile; names, phone, title, code, join date, salesperson flag and default location', async () => {
      const b = await business();
      const m = await addMember(b, ['Salesperson'], 'profile@biz.test');
      const location = await prisma().inventoryLocation.findFirstOrThrow({
        where: { workspaceId: b.workspaceId },
      });
      const res = await http
        .patch(
          `/users/${m.userId}`,
          {
            firstName: 'Samir',
            phone: '+92 300 1234567',
            jobTitle: 'Showroom lead',
            employeeCode: 'E-17',
            joinDate: '2026-01-15',
            isSalesperson: true,
            defaultLocationId: location.id,
          },
          b.token,
        )
        .expect(200);
      expect(res.body.data).toMatchObject({
        firstName: 'Samir',
        jobTitle: 'Showroom lead',
        employeeCode: 'E-17',
        isSalesperson: true,
        defaultLocationId: location.id,
      });
      expect(res.body.data.joinDate).toBe('2026-01-15T00:00:00.000Z');
      expect(res.body.data.roles.map((r: Json) => r.name)).toEqual(['Salesperson']); // roles untouched
      const event = await prisma().auditEvent.findFirstOrThrow({
        where: { workspaceId: b.workspaceId, action: 'user.update', entityId: m.userId },
      });
      expect(event.newState).toMatchObject({ firstName: 'Samir', jobTitle: 'Showroom lead' });
      expect(event.previousState).toMatchObject({ firstName: 'Sam' });
      await http.patch(`/users/${m.userId}`, { surprise: 1 }, b.token).expect(400);
    });

    it('does not reveal or change users of another workspace', async () => {
      const b = await business();
      const other = await business();
      const outsider = await addMember(other, ['Cashier'], 'outsider2@biz.test');
      await http.get(`/users/${outsider.userId}`, b.token).expect(404);
      await http.patch(`/users/${outsider.userId}`, { firstName: 'Hacked' }, b.token).expect(404);
      await http.post(`/users/${outsider.userId}/deactivate`, {}, b.token).expect(404);
      await http.post(`/users/${outsider.userId}/reset-link`, {}, b.token).expect(404);
      expect(
        (await prisma().user.findUniqueOrThrow({ where: { id: outsider.userId } })).firstName,
      ).toBe('Sam');
    });

    it('needs the matching permission for each action', async () => {
      const b = await business();
      const cashier = await addMember(b, ['Cashier'], 'cashier@biz.test');
      await http.get('/users', cashier.token).expect(403);
      await http
        .post(
          '/users/invite',
          { email: 'z@biz.test', roleIds: [b.roleId('Viewer')] },
          cashier.token,
        )
        .expect(403);
      await http.get('/roles', cashier.token).expect(403);
      await http.get('/permissions', cashier.token).expect(403);
    });
  });

  describe('role changes (Requirements 2.7, 45.7)', () => {
    it('applies a role change on the next request, without a new login', async () => {
      const b = await business();
      const m = await addMember(b, ['Cashier'], 'promote@biz.test');
      await http.get('/auth/me', m.token).expect(200);
      await http.get('/users', m.token).expect(403);

      await http
        .patch(
          `/users/${m.userId}`,
          { roleIds: [b.roleId('Cashier'), b.roleId('Manager')] },
          b.token,
        )
        .expect(200);

      const stale = await http.get('/auth/me', m.token).expect(401);
      expect(stale.body.code).toBe('TOKEN_STALE');
      const refreshed = await http
        .post('/auth/refresh', { refreshToken: m.refreshToken })
        .expect(200);
      await http.get('/users', refreshed.body.data.accessToken).expect(200); // union of both roles
      expect(bearerPayload(refreshed.body.data.accessToken).permissions).toEqual(
        expect.arrayContaining(['pos:sell', 'user:view']),
      );
    });

    it('changing roles needs role:configure on top of user:edit (Requirement 2.9)', async () => {
      const b = await business();
      const m = await addMember(b, ['Cashier'], 'target@biz.test');
      const custom = await http
        .post('/roles', { name: 'HR', permissions: ['user:view', 'user:edit'] }, b.token)
        .expect(201);
      const hr = await addMember(b, [], 'hr@biz.test').catch(() => null);
      expect(hr).toBeNull(); // an invitation needs at least one role
      const invite = await http
        .post('/users/invite', { email: 'hr@biz.test', roleIds: [custom.body.data.id] }, b.token)
        .expect(201);
      await http
        .post('/auth/invite/accept', {
          token: invite.body.data.token,
          password: 'hr-password-123',
          firstName: 'H',
          lastName: 'R',
        })
        .expect(200);
      const hrToken = (
        await http.post('/auth/login', { email: 'hr@biz.test', password: 'hr-password-123' })
      ).body.data.accessToken;

      await http.patch(`/users/${m.userId}`, { jobTitle: 'Teller' }, hrToken).expect(200);
      const denied = await http
        .patch(`/users/${m.userId}`, { roleIds: [b.roleId('Manager')] }, hrToken)
        .expect(403);
      expect(denied.body.code).toBe('PERMISSION_DENIED');
    });

    it('only an Owner can change who holds the Owner role', async () => {
      const b = await business();
      const manager = await addMember(b, ['Manager'], 'mgr2@biz.test');
      const cashier = await addMember(b, ['Cashier'], 'c2@biz.test');
      await http
        .patch(`/users/${cashier.userId}`, { roleIds: [b.roleId('Owner')] }, manager.token)
        .expect(403);
      await http
        .patch(`/users/${cashier.userId}`, { roleIds: [b.roleId('Owner')] }, b.token)
        .expect(200);
    });
  });

  describe('the last Owner is protected (Requirement 3.6)', () => {
    it('cannot be demoted, deactivated or removed while they are the only Owner', async () => {
      const b = await business();
      const owner = (await http.get('/users', b.token)).body.data[0] as Json;
      const demote = await http
        .patch(`/users/${owner.id}`, { roleIds: [b.roleId('Manager')] }, b.token)
        .expect(400);
      expect(demote.body.details.userId).toBeDefined();
      await http.post(`/users/${owner.id}/deactivate`, {}, b.token).expect(400);
      const ownerRole = await prisma().role.findFirstOrThrow({
        where: { workspaceId: b.workspaceId, isOwner: true },
      });
      await http
        .del(`/roles/${ownerRole.id}?fallbackRoleId=${b.roleId('Manager')}`, b.token)
        .expect(403);
      expect((await http.get(`/users/${owner.id}`, b.token)).body.data.status).toBe('ACTIVE');
    });

    it('a second Owner makes demotion and deactivation possible again', async () => {
      const b = await business();
      const second = await addMember(b, ['Manager'], 'second@biz.test');
      await http
        .patch(`/users/${second.userId}`, { roleIds: [b.roleId('Owner')] }, b.token)
        .expect(200);
      const first = (await http.get('/users?limit=100', b.token)).body.data.find(
        (u: Json) => u.email === b.email,
      ) as Json;
      await http
        .patch(`/users/${first.id}`, { roleIds: [b.roleId('Manager')] }, b.token)
        .expect(200);
      // the new Owner is now the only one and cannot be removed
      const freshToken = (
        await http.post('/auth/login', { email: 'second@biz.test', password: 'member-password-1' })
      ).body.data.accessToken;
      await http.post(`/users/${second.userId}/deactivate`, {}, freshToken).expect(400);
    });
  });

  describe('deactivation (Requirement 3.7)', () => {
    it('ends sessions immediately, blocks logins, keeps history, and can be undone', async () => {
      const b = await business();
      const m = await addMember(b, ['Salesperson'], 'leaver@biz.test');
      await http.post('/auth/login', { email: m.email, password: m.password }).expect(200); // a second session
      await http.get('/auth/me', m.token).expect(200);
      const eventsBefore = await prisma().auditEvent.count({
        where: { workspaceId: b.workspaceId, actorUserId: m.userId },
      });
      expect(eventsBefore).toBeGreaterThan(0);

      const res = await http.post(`/users/${m.userId}/deactivate`, {}, b.token).expect(200);
      expect(res.body.data.status).toBe('INACTIVE');

      expect((await http.get('/auth/me', m.token).expect(401)).body.code).toBe('TOKEN_STALE');
      await http.post('/auth/refresh', { refreshToken: m.refreshToken }).expect(401);
      await http.post('/auth/login', { email: m.email, password: m.password }).expect(403);
      const live = await prisma().userSession.count({
        where: { userId: m.userId, revokedAt: null },
      });
      expect(live).toBe(0);

      // History and the account itself are untouched.
      expect(
        await prisma().auditEvent.count({
          where: { workspaceId: b.workspaceId, actorUserId: m.userId },
        }),
      ).toBeGreaterThanOrEqual(eventsBefore);
      expect(await prisma().user.count({ where: { id: m.userId } })).toBe(1);
      expect(
        (await http.get('/users?status=INACTIVE', b.token)).body.data.map((u: Json) => u.id),
      ).toEqual([m.userId]);

      await http.post(`/users/${m.userId}/reactivate`, {}, b.token).expect(200);
      await http.post('/auth/login', { email: m.email, password: m.password }).expect(200);
    });
  });

  describe('reset link (Requirement 45.3)', () => {
    it('gives an admin a one-time link that resets the colleague’s password and ends their sessions', async () => {
      const b = await business();
      const m = await addMember(b, ['Cashier'], 'forgot@biz.test');
      const link = await http.post(`/users/${m.userId}/reset-link`, {}, b.token).expect(200);
      await http
        .post('/auth/password/reset', {
          token: link.body.data.token,
          newPassword: 'reset-by-admin-1',
        })
        .expect(204);
      await http
        .post('/auth/password/reset', {
          token: link.body.data.token,
          newPassword: 'reset-by-admin-2',
        })
        .expect(400);
      await http.post('/auth/refresh', { refreshToken: m.refreshToken }).expect(401);
      await http.post('/auth/login', { email: m.email, password: 'reset-by-admin-1' }).expect(200);
      expect(
        await prisma().auditEvent.count({
          where: {
            workspaceId: b.workspaceId,
            action: 'user.reset_link_created',
            entityId: m.userId,
          },
        }),
      ).toBe(1);
    });

    it('a non-Owner cannot generate a link for an Owner', async () => {
      const b = await business();
      const hr = await http
        .post('/roles', { name: 'Support', permissions: ['user:view', 'user:edit'] }, b.token)
        .expect(201);
      const invite = await http
        .post('/users/invite', { email: 'support@biz.test', roleIds: [hr.body.data.id] }, b.token)
        .expect(201);
      await http
        .post('/auth/invite/accept', {
          token: invite.body.data.token,
          password: 'support-pass-123',
          firstName: 'S',
          lastName: 'S',
        })
        .expect(200);
      const token = (
        await http.post('/auth/login', { email: 'support@biz.test', password: 'support-pass-123' })
      ).body.data.accessToken;
      const owner = (await http.get('/users', token)).body.data.find(
        (u: Json) => u.email === b.email,
      ) as Json;
      await http.post(`/users/${owner.id}/reset-link`, {}, token).expect(403);
    });
  });

  describe('roles (Requirements 3.3, 3.4, 3.5)', () => {
    it('creates, renames and edits custom roles; unknown or platform permissions are refused', async () => {
      const b = await business();
      const created = await http
        .post(
          '/roles',
          { name: 'Showroom', permissions: ['product:view', 'pos:sell'], maxDiscountPercent: 7.5 },
          b.token,
        )
        .expect(201);
      expect(created.body.data).toMatchObject({
        name: 'Showroom',
        isSystem: false,
        maxDiscountPercent: '7.5',
        memberCount: 0,
      });

      await http.post('/roles', { name: 'showroom', permissions: [] }, b.token).expect(400); // case-insensitive duplicate
      await http.post('/roles', { name: 'Bad', permissions: ['made:up'] }, b.token).expect(400);
      await http
        .post('/roles', { name: 'Bad2', permissions: ['platform:admin'] }, b.token)
        .expect(400);
      await http
        .post('/roles', { name: 'Bad3', permissions: [], maxDiscountPercent: 150 }, b.token)
        .expect(400);

      const patched = await http
        .patch(
          `/roles/${created.body.data.id}`,
          { name: 'Showroom staff', permissions: ['product:view'] },
          b.token,
        )
        .expect(200);
      expect(patched.body.data).toMatchObject({
        name: 'Showroom staff',
        permissions: ['product:view'],
      });
      await http.patch('/roles/missing', { name: 'x' }, b.token).expect(404);
    });

    it('a permission change reaches holders of the role on their next request', async () => {
      const b = await business();
      const role = await http
        .post('/roles', { name: 'Counter', permissions: ['pos:sell', 'product:view'] }, b.token)
        .expect(201);
      const invite = await http
        .post('/users/invite', { email: 'counter@biz.test', roleIds: [role.body.data.id] }, b.token)
        .expect(201);
      await http
        .post('/auth/invite/accept', {
          token: invite.body.data.token,
          password: 'counter-pass-123',
          firstName: 'C',
          lastName: 'C',
        })
        .expect(200);
      const session = (
        await http.post('/auth/login', { email: 'counter@biz.test', password: 'counter-pass-123' })
      ).body.data;
      await http.get('/auth/me', session.accessToken).expect(200);

      await http
        .patch(
          `/roles/${role.body.data.id}`,
          { permissions: ['pos:sell', 'product:view', 'inventory:view'] },
          b.token,
        )
        .expect(200);
      expect((await http.get('/auth/me', session.accessToken).expect(401)).body.code).toBe(
        'TOKEN_STALE',
      );
      const next = (
        await http.post('/auth/refresh', { refreshToken: session.refreshToken }).expect(200)
      ).body.data;
      expect(bearerPayload(next.accessToken).permissions).toContain('inventory:view');
    });

    it('the Owner role cannot be edited, and system roles cannot be deleted', async () => {
      const b = await business();
      const ownerRole = await prisma().role.findFirstOrThrow({
        where: { workspaceId: b.workspaceId, isOwner: true },
      });
      await http.patch(`/roles/${ownerRole.id}`, { permissions: [] }, b.token).expect(403);
      await http.patch(`/roles/${ownerRole.id}`, { name: 'Boss' }, b.token).expect(403);
      await http
        .del(`/roles/${b.roleId('Cashier')}?fallbackRoleId=${b.roleId('Viewer')}`, b.token)
        .expect(403);
      const listed = (await http.get('/roles', b.token)).body.data as Json[];
      expect(listed.find((r) => r.isOwner)?.permissions).toEqual([...WORKSPACE_PERMISSIONS]);
    });

    it('deleting a role moves its holders to the fallback role (Requirement 3.4)', async () => {
      const b = await business();
      const role = await http
        .post('/roles', { name: 'Temp', permissions: ['pos:sell'] }, b.token)
        .expect(201);
      const roleId = role.body.data.id as string;
      const invites = await Promise.all(
        ['t1', 't2'].map((x) =>
          http
            .post('/users/invite', { email: `${x}@biz.test`, roleIds: [roleId] }, b.token)
            .expect(201),
        ),
      );
      const accepted: string[] = [];
      for (const [i, inv] of invites.entries()) {
        await http
          .post('/auth/invite/accept', {
            token: inv.body.data.token,
            password: 'temp-password-12',
            firstName: 'T',
            lastName: String(i),
          })
          .expect(200);
        accepted.push(`t${i + 1}@biz.test`);
      }
      // one of them already holds the fallback role as well
      const t2 = (await http.get('/users?q=t2@biz.test', b.token)).body.data[0] as Json;
      await http
        .patch(`/users/${t2.id}`, { roleIds: [roleId, b.roleId('Viewer')] }, b.token)
        .expect(200);

      await http.del(`/roles/${roleId}`, b.token).expect(400); // fallback is required
      await http.del(`/roles/${roleId}?fallbackRoleId=${roleId}`, b.token).expect(400);
      await http
        .del(
          `/roles/${roleId}?fallbackRoleId=${(await prisma().role.findFirstOrThrow({ where: { workspaceId: b.workspaceId, isOwner: true } })).id}`,
          b.token,
        )
        .expect(400);
      await http.del(`/roles/${roleId}?fallbackRoleId=missing`, b.token).expect(400);

      await http.del(`/roles/${roleId}?fallbackRoleId=${b.roleId('Viewer')}`, b.token).expect(204);
      const members = (await http.get('/users?limit=100', b.token)).body.data as Json[];
      for (const email of accepted) {
        const member = members.find((u) => u.email === email) as Json;
        expect(member.roles.map((r: Json) => r.name)).toEqual(['Viewer']);
      }
      expect(await prisma().role.count({ where: { id: roleId } })).toBe(0);
      expect(
        await prisma().auditEvent.count({
          where: { workspaceId: b.workspaceId, action: 'role.delete', entityId: roleId },
        }),
      ).toBe(1);
    });

    it('serves the permission catalogue without platform permissions', async () => {
      const b = await business();
      const res = (await http.get('/permissions', b.token).expect(200)).body.data;
      expect(res.permissions).toEqual([...WORKSPACE_PERMISSIONS]);
      expect(res.resources.map((r: Json) => r.resource)).not.toContain('platform');
      expect(res.resources.find((r: Json) => r.resource === 'order').actions).toContain(
        'price_override',
      );
    });

    it('keeps roles of different workspaces separate', async () => {
      const a = await business();
      const other = await business();
      const roleOfOther = other.roleId('Manager');
      await http.patch(`/roles/${roleOfOther}`, { name: 'Hijacked' }, a.token).expect(404);
      await http
        .del(`/roles/${roleOfOther}?fallbackRoleId=${a.roleId('Viewer')}`, a.token)
        .expect(404);
      await http
        .post('/users/invite', { email: 'cross@biz.test', roleIds: [roleOfOther] }, a.token)
        .expect(400);
    });
  });

  it('an unrelated seeded user keeps working (sanity)', async () => {
    const u = await seedUser(prisma(), app.get(PasswordService), 'ws_sanity', {
      permissions: ['user:view'],
    });
    const login = await http
      .post('/auth/login', { email: u.email, password: u.password })
      .expect(200);
    await http.get('/users', login.body.data.accessToken).expect(200);
  });
});
