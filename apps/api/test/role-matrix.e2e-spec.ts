import { DEFAULT_ROLES } from '@bms/types';
import request from 'supertest';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { listRoutes, type RouteInfo } from './helpers/routes';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

/**
 * What each default Role must NOT hold. Together with DEFAULT_ROLES (next to the permission
 * catalogue) this is the table the matrix below is checked against: if a role gains a permission
 * that is listed here, or the table and the roles disagree about a route, the test fails and the
 * change has to be a deliberate one (Requirement 20.11).
 */
const MUST_NOT_HOLD: Record<string, string[]> = {
  Salesperson: [
    'user:create',
    'user:edit',
    'user:deactivate',
    'role:configure',
    'workspace:configure',
    'audit:view',
    'payment:confirm',
    'payment:void',
    'payment:refund',
    'expense:create',
    'account:view',
    'commission:approve',
    'commission:pay',
    'commission:configure',
    'product:view_cost',
    'order:price_override',
    'order:discount_override',
    'order:approve',
    'quotation:approve',
    'integration:manage',
    'ai:control',
    'import:run',
    'inventory:adjust',
  ],
  Cashier: [
    'lead:view',
    'quotation:view',
    'order:view',
    'purchase:view',
    'supplier:view',
    'workspace:configure',
    'payment:void',
    'payment:refund',
    'pos:refund',
    'expense:create',
    'report:view',
    'product:view_cost',
    'user:view',
    'audit:view',
    'integration:view',
    'conversation:view',
    'inventory:adjust',
  ],
  'Inventory Staff': [
    'payment:view',
    'payment:create',
    'expense:view',
    'account:view',
    'order:view',
    'pos:sell',
    'customer:view',
    'lead:view',
    'report:financial',
    'product:view_cost',
    'commission:view',
    'user:view',
    'audit:view',
    'inventory:approve',
    'purchase:approve',
  ],
  'Account Staff': [
    'inventory:adjust',
    'product:create',
    'product:edit',
    'customer:edit',
    'lead:view',
    'order:create',
    'order:edit',
    'pos:sell',
    'user:create',
    'role:configure',
    'workspace:configure',
    'integration:manage',
    'ai:use',
    'account:configure',
  ],
  'Production Staff': [
    'order:view',
    'customer:view',
    'payment:view',
    'product:view',
    'inventory:view',
    'report:view',
    'lead:view',
    'conversation:view',
    'user:view',
    'audit:view',
    'product:view_cost',
  ],
  'AI/Automation Operator': [
    'payment:view',
    'order:view',
    'customer:view',
    'lead:view',
    'product:view_cost',
    'report:view',
    'inventory:view',
    'pos:sell',
    'user:view',
    'audit:view',
    'integration:manage',
    'workspace:configure',
  ],
  Viewer: [
    'audit:view',
    'integration:view',
    'payment:view',
    'expense:view',
    'account:view',
    'report:financial',
    'product:view_cost',
  ],
  Manager: [
    'role:configure',
    'workspace:configure',
    'field:configure',
    'workflow:configure',
    'account:configure',
    'integration:manage',
  ],
};

const WRITE_ACTIONS = new Set([
  'create',
  'edit',
  'archive',
  'adjust',
  'transfer',
  'count',
  'approve',
  'receive',
  'return',
  'merge',
  'anonymize',
  'assign',
  'send',
  'cancel',
  'sell',
  'void',
  'refund',
  'confirm',
  'pay',
  'configure',
  'manage',
  'reply',
  'run',
  'deactivate',
  'open_session',
  'close_session',
  'cash_movement',
  'reprint',
  'use',
  'control',
  'build',
]);

// this test sends far more than a person's 300 requests a minute on purpose (the limit itself is tested in security-review)
process.env['RATE_LIMIT_PER_USER'] = '1000000';

describe('Role matrix — every route with every default Role', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let routes: RouteInfo[];
  const tokens = new Map<string, string[]>();
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
    routes = listRoutes(t.app);
    const email = 'owner@matrix.test';
    await t.app.get(TenantsService).createWorkspace({
      name: 'Role Matrix',
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
    });
    const owner = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const roles = (await http.get('/roles', owner)).body.data as Json[];
    // two people per role: a person's requests are limited to 300 a minute, and there are more routes than that
    for (const role of DEFAULT_ROLES) {
      const id = (roles.find((r) => r.name === role.name) as Json).id as string;
      const list: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        const address = `${role.name.toLowerCase().replace(/\W/g, '')}${i}@matrix.test`;
        const invite = await http
          .post('/users/invite', { email: address, roleIds: [id] }, owner)
          .expect(201);
        await http
          .post('/auth/invite/accept', {
            token: invite.body.data.token,
            password: 'member-password-1',
            firstName: role.name,
            lastName: `${i}`,
          })
          .expect(200);
        list.push(
          (
            await http
              .post('/auth/login', { email: address, password: 'member-password-1' })
              .expect(200)
          ).body.data.accessToken as string,
        );
      }
      tokens.set(role.name, list);
    }
  }, 180_000);
  afterAll(() => t.close());

  const call = (r: RouteInfo, token: string) => {
    const agent = request(t.app.getHttpServer()) as unknown as Record<
      string,
      (p: string) => request.Test
    >;
    return agent[r.method.toLowerCase()]!(r.path.replace(/:\w+/g, 'x'))
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', `10.${(++n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`)
      .send({});
  };

  it('has one entry for each default Role and finds the routes', () => {
    expect([...tokens.keys()].sort()).toEqual(DEFAULT_ROLES.map((r) => r.name).sort());
    expect(routes.filter((r) => r.permission).length).toBeGreaterThan(150);
  });

  it('allows a route exactly to the Roles that hold its permission, and never answers 500', async () => {
    const guarded = routes.filter((r) => r.permission);
    const wrong: string[] = [];
    for (const role of DEFAULT_ROLES) {
      const held = new Set<string>(role.permissions);
      const mine = tokens.get(role.name) as string[];
      for (const [i, route] of guarded.entries()) {
        const res = await call(route, mine[i % mine.length] as string);
        const allowed = held.has(route.permission as string);
        const label = `${role.name} ${route.method} ${route.path} -> ${res.status} ${res.body?.code ?? ''}`;
        if (allowed) {
          if (res.status === 401 || res.body?.code === 'PERMISSION_DENIED' || res.status >= 500)
            wrong.push(`${label} (should be allowed)`);
        } else if (res.status !== 403 || res.body?.code !== 'PERMISSION_DENIED') {
          wrong.push(`${label} (should be denied)`);
        }
      }
    }
    expect(wrong).toEqual([]);
  }, 600_000);

  it('every Role can reach the routes that need only a session', async () => {
    for (const [name, list] of tokens) {
      const res = await http.get('/auth/me', list[0]);
      expect([name, res.status]).toEqual([name, 200]);
      expect([name, (await http.get('/notifications/unread-count', list[0])).status]).toEqual([
        name,
        200,
      ]);
    }
  });

  describe('least privilege (Requirement 20.11)', () => {
    const byName = new Map(DEFAULT_ROLES.map((r) => [r.name, new Set<string>(r.permissions)]));

    it.each(Object.entries(MUST_NOT_HOLD))(
      '%s holds none of what it should not',
      (name, forbidden) => {
        const held = byName.get(name) as Set<string>;
        expect(forbidden.filter((p) => held.has(p))).toEqual([]);
      },
    );

    it('Viewer can only look: every permission is a view', () => {
      const viewer = [...(byName.get('Viewer') as Set<string>)];
      expect(viewer.filter((p) => WRITE_ACTIONS.has(p.split(':')[1] as string))).toEqual([]);
    });

    it('only the Owner configures the workspace, its roles and its connections', () => {
      for (const p of [
        'workspace:configure',
        'role:configure',
        'integration:manage',
        'account:configure',
        'field:configure',
        'workflow:configure',
      ]) {
        const holders = DEFAULT_ROLES.filter((r) =>
          (r.permissions as readonly string[]).includes(p),
        ).map((r) => r.name);
        expect([p, holders]).toEqual([p, p === 'integration:manage' ? ['Owner'] : ['Owner']]);
      }
    });

    it('nobody but the Owner has a permission the others lack, except the AI operator for automation', () => {
      const owner = byName.get('Owner') as Set<string>;
      for (const role of DEFAULT_ROLES) {
        for (const p of role.permissions)
          expect([role.name, p, owner.has(p)]).toEqual([role.name, p, true]);
      }
    });
  });
});
