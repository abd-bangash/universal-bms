import { Controller, Get, type INestApplication } from '@nestjs/common';
import { RequireModule } from '../src/common/decorators/require-module.decorator';
import { RequirePermission } from '../src/common/decorators/require-permission.decorator';
import { PasswordService } from '../src/modules/auth/password.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

/** A stand-in for a real module route (POS arrives in task 51): needs the pos module and a permission. */
@Controller('probe')
class ProbeController {
  @Get('pos')
  @RequireModule('pos')
  @RequirePermission('pos:sell')
  pos() {
    return { ok: true };
  }
  @Get('ungated')
  @RequirePermission('pos:sell')
  ungated() {
    return { ok: true };
  }
}

describe('Settings (real PostgreSQL)', () => {
  let t: TestApp;
  let app: INestApplication;
  let http: ReturnType<typeof api>;
  let tenants: TenantsService;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp({}, { controllers: [ProbeController] });
    app = t.app;
    http = api(app);
    tenants = app.get(TenantsService);
    app.get(PasswordService);
  }, 90_000);
  afterAll(() => t.close());

  const prisma = () => t.db.prisma;

  async function business() {
    n += 1;
    const email = `owner${n}@settings.test`;
    const created = await tenants.createWorkspace({
      name: `Settings Co ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'W', password: 'owner-password-1' },
    });
    const login = await http
      .post('/auth/login', { email, password: 'owner-password-1' })
      .expect(200);
    const token = login.body.data.accessToken as string;
    const roles = (await http.get('/roles', token)).body.data as Json[];
    const invite = async (roleName: string, address: string) => {
      const inv = await http
        .post(
          '/users/invite',
          { email: address, roleIds: [(roles.find((r) => r.name === roleName) as Json).id] },
          token,
        )
        .expect(201);
      await http
        .post('/auth/invite/accept', {
          token: inv.body.data.token,
          password: 'member-password-1',
          firstName: 'M',
          lastName: 'M',
        })
        .expect(200);
      return (await http.post('/auth/login', { email: address, password: 'member-password-1' }))
        .body.data.accessToken as string;
    };
    return { ...created, token, invite };
  }

  describe('GET and PATCH /settings (Requirements 5.1, 5.2, 5.4, 1.7)', () => {
    it('returns the validated configuration and its version', async () => {
      const b = await business();
      const res = (await http.get('/settings', b.token).expect(200)).body.data;
      expect(res.configVersion).toBeGreaterThanOrEqual(1);
      expect(res.config.sales.requiredDepositPercent).toBe(50);
      expect(res.config.locale.currency).toBe('USD');
    });

    it('applies a partial change, bumps the version, and audits exactly the changed paths', async () => {
      const b = await business();
      const before = (await http.get('/settings', b.token)).body.data;
      const res = await http
        .patch(
          '/settings',
          {
            sales: { requiredDepositPercent: 30 },
            business: { legalName: 'Renamed Co', phone: '+92 300 0000000' },
            locale: { currency: 'PKR' },
          },
          b.token,
        )
        .expect(200);
      expect(res.body.data.configVersion).toBe(before.configVersion + 1);
      expect(res.body.data.config.sales).toMatchObject({
        requiredDepositPercent: 30,
        discountOverLimit: 'REJECT',
      });
      expect(res.body.data.config.business.legalName).toBe('Renamed Co');

      const event = await prisma().auditEvent.findFirstOrThrow({
        where: { workspaceId: b.workspaceId, action: 'settings.update' },
        orderBy: { createdAt: 'desc' },
      });
      expect(Object.keys(event.newState as object).sort()).toEqual([
        'business.legalName',
        'business.phone',
        'locale.currency',
        'sales.requiredDepositPercent',
      ]);
      expect(event.previousState).toMatchObject({
        'sales.requiredDepositPercent': 50,
        'locale.currency': 'USD',
      });
      expect(event.metadata).toMatchObject({ configVersion: before.configVersion + 1 });
    });

    it('takes effect on the next request without a restart', async () => {
      const b = await business();
      await http
        .patch(
          '/settings',
          { messaging: { optOutKeywords: ['STOP', 'QUIT'] }, ai: { mode: 'ASSIST' } },
          b.token,
        )
        .expect(200);
      const next = (await http.get('/settings', b.token)).body.data.config;
      expect(next.messaging.optOutKeywords).toEqual(['STOP', 'QUIT']);
      expect(next.ai.mode).toBe('ASSIST');
      const stored = await prisma().workspace.findUniqueOrThrow({ where: { id: b.workspaceId } });
      expect((stored.config as Json).ai.mode).toBe('ASSIST');
    });

    it('rejects invalid values with the path of each problem and changes nothing', async () => {
      const b = await business();
      const before = await prisma().workspace.findUniqueOrThrow({ where: { id: b.workspaceId } });
      const res = await http
        .patch(
          '/settings',
          {
            sales: { requiredDepositPercent: 150 },
            locale: { timezone: 'Mars/Base' },
            surprise: true,
            modules: { pos: 'yes' },
          },
          b.token,
        )
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(res.body.details).sort()).toEqual([
        'locale.timezone',
        'modules.pos',
        'sales.requiredDepositPercent',
        'surprise',
      ]);
      const after = await prisma().workspace.findUniqueOrThrow({ where: { id: b.workspaceId } });
      expect(after.configVersion).toBe(before.configVersion);
      expect(after.config).toEqual(before.config);
      await http.patch('/settings', [] as unknown as object, b.token).expect(400);
    });

    it('clears an optional setting when it is sent empty', async () => {
      const b = await business();
      await http
        .patch(
          '/settings',
          { business: { phone: '+92 300 1111111', email: 'info@settings.test' } },
          b.token,
        )
        .expect(200);
      const res = await http
        .patch('/settings', { business: { phone: '', email: '' } }, b.token)
        .expect(200);
      expect(res.body.data.config.business.phone).toBeUndefined();
      expect(res.body.data.config.business.email).toBeUndefined();
      const stored = await prisma().workspace.findUniqueOrThrow({ where: { id: b.workspaceId } });
      expect(Object.keys((stored.config as Json).business)).not.toContain('phone');
    });

    it('a change that alters nothing is not a new version and writes no audit event', async () => {
      const b = await business();
      const v = (await http.get('/settings', b.token)).body.data.configVersion;
      const count = await prisma().auditEvent.count({
        where: { workspaceId: b.workspaceId, action: 'settings.update' },
      });
      const res = await http
        .patch('/settings', { sales: { requiredDepositPercent: 50 } }, b.token)
        .expect(200);
      expect(res.body.data.configVersion).toBe(v);
      expect(
        await prisma().auditEvent.count({
          where: { workspaceId: b.workspaceId, action: 'settings.update' },
        }),
      ).toBe(count);
    });

    it('needs the right permissions: view to read, configure to change', async () => {
      const b = await business();
      const manager = await b.invite('Manager', 'mgr@settings.test'); // can view, cannot configure
      const cashier = await b.invite('Cashier', 'cashier@settings.test');
      await http.get('/settings', manager).expect(200);
      await http.patch('/settings', { business: { legalName: 'X' } }, manager).expect(403);
      await http.get('/settings', cashier).expect(403);
    });

    it('keeps workspaces apart', async () => {
      const a = await business();
      const other = await business();
      await http.patch('/settings', { business: { legalName: 'Only A' } }, a.token).expect(200);
      expect((await http.get('/settings', other.token)).body.data.config.business.legalName).toBe(
        `Settings Co ${n}`,
      );
    });

    it('exposes locale settings to every signed-in member through /auth/me', async () => {
      const b = await business();
      await http
        .patch('/settings', { locale: { currency: 'PKR', timezone: 'Asia/Karachi' } }, b.token)
        .expect(200);
      const cashier = await b.invite('Cashier', 'locale@settings.test');
      const me = (await http.get('/auth/me', cashier).expect(200)).body.data;
      expect(me.workspace.locale).toMatchObject({ currency: 'PKR', timezone: 'Asia/Karachi' });
      expect(me.terminology.productionJob.singular).toBe('Workshop Job');
    });
  });

  describe('module toggles (Requirement 5.3)', () => {
    it('switching a module off blocks its routes on the next request, switching on restores them', async () => {
      const b = await business();
      const cashier = await b.invite('Cashier', 'toggle@settings.test');
      await http.get('/probe/pos', cashier).expect(200);

      await http.patch('/settings', { modules: { pos: false } }, b.token).expect(200);
      const blocked = await http.get('/probe/pos', cashier).expect(403);
      expect(blocked.body.code).toBe('MODULE_DISABLED');
      await http.get('/probe/ungated', cashier).expect(200); // other routes are unaffected

      await http.patch('/settings', { modules: { pos: true } }, b.token).expect(200);
      await http.get('/probe/pos', cashier).expect(200);
    });

    it('does not leak across workspaces', async () => {
      const a = await business();
      const other = await business();
      const cashierA = await a.invite('Cashier', 'iso-a@settings.test');
      const cashierB = await other.invite('Cashier', 'iso-b@settings.test');
      await http.patch('/settings', { modules: { pos: false } }, a.token).expect(200);
      await http.get('/probe/pos', cashierA).expect(403);
      await http.get('/probe/pos', cashierB).expect(200);
    });
  });

  describe('units (Requirements 28.4, 28.5)', () => {
    it('lists the profile units to every member and lets configurators add and rename', async () => {
      const b = await business();
      const cashier = await b.invite('Cashier', 'units@settings.test');
      const list = (await http.get('/settings/units', cashier).expect(200)).body.data as Json[];
      expect(list).toHaveLength(12);
      expect(list.find((u) => u.symbol === 'ft')).toMatchObject({
        dimension: 'length',
        toBase: '0.3048',
      });

      const created = await http
        .post(
          '/settings/units',
          { name: 'Yard', symbol: 'yd', dimension: 'length', toBase: '0.9144' },
          b.token,
        )
        .expect(201);
      expect(created.body.data).toMatchObject({ symbol: 'yd', toBase: '0.9144' });
      await http
        .post(
          '/settings/units',
          { name: 'Yard 2', symbol: 'yd', dimension: 'length', toBase: '0.9144' },
          b.token,
        )
        .expect(400); // duplicate symbol
      await http
        .post(
          '/settings/units',
          { name: 'Bad', symbol: 'bd', dimension: 'length', toBase: '0' },
          b.token,
        )
        .expect(400);
      await http
        .post(
          '/settings/units',
          { name: 'Bad', symbol: 'bd', dimension: 'length', toBase: '1.234567891' },
          b.token,
        )
        .expect(400);
      await http
        .post(
          '/settings/units',
          { name: 'Bad', symbol: 'bd', dimension: 'length', toBase: 0.5 },
          b.token,
        )
        .expect(400); // numbers are refused
      await http
        .post(
          '/settings/units',
          { name: 'Bad', symbol: 'bd', dimension: 'speed', toBase: '1' },
          b.token,
        )
        .expect(400);
      await http
        .post(
          '/settings/units',
          { name: 'Nope', symbol: 'np', dimension: 'count', toBase: '1' },
          cashier,
        )
        .expect(403);

      const renamed = await http
        .patch(`/settings/units/${created.body.data.id}`, { name: 'Yards', symbol: 'yds' }, b.token)
        .expect(200);
      expect(renamed.body.data).toMatchObject({ name: 'Yards', symbol: 'yds', toBase: '0.9144' });
      await http
        .patch(`/settings/units/${created.body.data.id}`, { toBase: '2' }, b.token)
        .expect(400); // the factor is fixed
      await http.patch('/settings/units/missing', { name: 'x' }, b.token).expect(404);
    });

    it('a symbol may repeat across workspaces', async () => {
      const a = await business();
      const other = await business();
      await http
        .post(
          '/settings/units',
          { name: 'Bundle', symbol: 'bdl', dimension: 'count', toBase: '10' },
          a.token,
        )
        .expect(201);
      await http
        .post(
          '/settings/units',
          { name: 'Bundle', symbol: 'bdl', dimension: 'count', toBase: '10' },
          other.token,
        )
        .expect(201);
      const unitOfA = (await http.get('/settings/units', a.token)).body.data.find(
        (u: Json) => u.symbol === 'bdl',
      );
      await http.patch(`/settings/units/${unitOfA.id}`, { name: 'x' }, other.token).expect(404);
    });
  });

  describe('tax classes', () => {
    it('creates, edits and deactivates tax classes with exact decimal rates', async () => {
      const b = await business();
      const created = await http
        .post('/settings/tax-classes', { name: 'GST 17%', rate: '0.1700' }, b.token)
        .expect(201);
      expect(created.body.data).toMatchObject({ name: 'GST 17%', rate: '0.17', active: true });
      await http
        .post('/settings/tax-classes', { name: 'gst 17%', rate: '0.17' }, b.token)
        .expect(400);
      await http
        .post('/settings/tax-classes', { name: 'Too much', rate: '1.5' }, b.token)
        .expect(400);
      await http
        .post('/settings/tax-classes', { name: 'Precise', rate: '0.12345' }, b.token)
        .expect(400);
      await http.post('/settings/tax-classes', { name: 'Float', rate: 0.17 }, b.token).expect(400);

      const patched = await http
        .patch(
          `/settings/tax-classes/${created.body.data.id}`,
          { rate: '0.1800', active: false },
          b.token,
        )
        .expect(200);
      expect(patched.body.data).toMatchObject({ rate: '0.18', active: false });
      expect((await http.get('/settings/tax-classes', b.token)).body.data).toHaveLength(1);
      const event = await prisma().auditEvent.findFirstOrThrow({
        where: { workspaceId: b.workspaceId, action: 'tax_class.update' },
      });
      expect(event.newState).toEqual({ rate: '0.18', active: false });
    });
  });

  describe('lost reasons and the walk-in customer', () => {
    it('a new workspace has the profile lost reasons and exactly one walk-in customer', async () => {
      const b = await business();
      const reasons = (await http.get('/settings/lost-reasons', b.token).expect(200)).body
        .data as Json[];
      expect(reasons.map((r) => r.name)).toEqual(
        expect.arrayContaining(['Price too high', 'Chose a competitor']),
      );
      const walkIns = await prisma().customer.findMany({
        where: { workspaceId: b.workspaceId, isWalkIn: true },
      });
      expect(walkIns).toHaveLength(1);
      expect(walkIns[0]?.fullName).toBe('Walk-in customer');

      // applying the profile again changes nothing
      await http.post('/settings/apply-profile/furniture', {}, b.token).expect(200);
      expect((await http.get('/settings/lost-reasons', b.token)).body.data).toHaveLength(
        reasons.length,
      );
      expect(
        await prisma().customer.count({ where: { workspaceId: b.workspaceId, isWalkIn: true } }),
      ).toBe(1);
    });

    it('adds, renames and deactivates reasons; reasons are never deleted and stay per workspace', async () => {
      const a = await business();
      const other = await business();
      const created = await http
        .post('/settings/lost-reasons', { name: 'Delivery too slow' }, a.token)
        .expect(201);
      expect(created.body.data).toMatchObject({ name: 'Delivery too slow', active: true });
      await http.post('/settings/lost-reasons', { name: 'delivery TOO slow' }, a.token).expect(400);
      await http
        .patch(`/settings/lost-reasons/${created.body.data.id}`, { name: 'Delivery slow' }, a.token)
        .expect(200);
      await http
        .patch(`/settings/lost-reasons/${created.body.data.id}`, { active: false }, a.token)
        .expect(200);
      const active = (await http.get('/settings/lost-reasons', a.token)).body.data as Json[];
      expect(active.map((r) => r.name)).not.toContain('Delivery slow');
      const all = (await http.get('/settings/lost-reasons?includeInactive=true', a.token)).body
        .data as Json[];
      expect(all.map((r) => r.name)).toContain('Delivery slow');
      expect(
        (
          (await http.get('/settings/lost-reasons?includeInactive=true', other.token)).body
            .data as Json[]
        ).map((r) => r.name),
      ).not.toContain('Delivery slow');
      await http
        .patch(`/settings/lost-reasons/${created.body.data.id}`, { name: 'x' }, other.token)
        .expect(404);
      const event = await prisma().auditEvent.findFirst({
        where: { workspaceId: a.workspaceId, action: 'lost_reason.update' },
      });
      expect(event).not.toBeNull();
    });
  });

  describe('industry profiles', () => {
    it('lists the profiles and applies one again without harm', async () => {
      const b = await business();
      const list = (await http.get('/settings/industry-profiles', b.token).expect(200)).body
        .data as Json[];
      expect(list).toEqual([expect.objectContaining({ key: 'furniture', isCurrent: true })]);

      const fields = await prisma().fieldDefinition.count({
        where: { workspaceId: b.workspaceId },
      });
      const res = await http.post('/settings/apply-profile/furniture', {}, b.token).expect(200);
      expect(res.body.data).toMatchObject({
        fieldDefinitions: 0,
        workflows: 0,
        states: 0,
        transitions: 0,
        units: 0,
      });
      expect(await prisma().fieldDefinition.count({ where: { workspaceId: b.workspaceId } })).toBe(
        fields,
      );
      expect(
        await prisma().auditEvent.count({
          where: { workspaceId: b.workspaceId, action: 'settings.apply_profile' },
        }),
      ).toBe(1);

      await http.post('/settings/apply-profile/spaceships', {}, b.token).expect(404);
      await http.post('/settings/apply-profile/Bad-Key', {}, b.token).expect(400);
    });

    it('adds what a profile defines but the workspace is missing, and never removes anything', async () => {
      const b = await business();
      await prisma().fieldDefinition.deleteMany({
        where: { workspaceId: b.workspaceId, entityType: 'PRODUCT', key: 'finish' },
      });
      await prisma().fieldDefinition.create({
        data: {
          workspaceId: b.workspaceId,
          entityType: 'PRODUCT',
          key: 'warranty',
          label: 'Warranty',
          type: 'TEXT',
        },
      });
      const res = await http.post('/settings/apply-profile/furniture', {}, b.token).expect(200);
      expect(res.body.data.fieldDefinitions).toBe(1);
      const keys = (
        await prisma().fieldDefinition.findMany({
          where: { workspaceId: b.workspaceId, entityType: 'PRODUCT' },
        })
      ).map((f) => f.key);
      expect(keys).toEqual(expect.arrayContaining(['finish', 'warranty']));
    });
  });
});
