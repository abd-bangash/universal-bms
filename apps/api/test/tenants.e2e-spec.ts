import { DEFAULT_ROLES, DOCUMENT_TYPES, WORKSPACE_PERMISSIONS } from '@bms/types';
import { AuditService } from '../src/modules/audit/audit.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { TokenService } from '../src/modules/auth/token.service';
import { IndustryProfileService } from '../src/modules/tenants/industry-profile.service';
import {
  ProfileSectionRegistry,
  WorkspaceDefaultsRegistry,
} from '../src/modules/tenants/registries';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, bearerPayload, createTestApp, seedUser, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON read back from the database

const owner = (email: string) => ({
  email,
  firstName: 'Olivia',
  lastName: 'Owner',
  password: 'owner-password-1',
});

describe('Workspace creation and industry profiles (real PostgreSQL)', () => {
  let t: TestApp;
  let tenants: TenantsService;
  let profiles: IndustryProfileService;
  let defaults: WorkspaceDefaultsRegistry;
  let sections: ProfileSectionRegistry;

  beforeAll(async () => {
    t = await createTestApp();
    tenants = t.app.get(TenantsService);
    profiles = t.app.get(IndustryProfileService);
    defaults = t.app.get(WorkspaceDefaultsRegistry);
    sections = t.app.get(ProfileSectionRegistry);
    t.app.get(AuditService).sleep = async () => undefined;
  }, 90_000);
  afterAll(() => t.close());

  const prisma = () => t.db.prisma;
  const countRows = async (workspaceId: string) => ({
    fields: await prisma().fieldDefinition.count({ where: { workspaceId } }),
    workflows: await prisma().workflow.count({ where: { workspaceId } }),
    states: await prisma().workflowState.count({ where: { workspaceId } }),
    transitions: await prisma().workflowTransition.count({ where: { workspaceId } }),
    units: await prisma().unit.count({ where: { workspaceId } }),
    roles: await prisma().role.count({ where: { workspaceId } }),
    locations: await prisma().inventoryLocation.count({ where: { workspaceId } }),
    sequences: await prisma().documentSequence.count({ where: { workspaceId } }),
  });

  describe('Requirement 50.1: a new workspace has every default', () => {
    let workspaceId: string;
    let ownerUserId: string;
    let membershipId: string;

    beforeAll(async () => {
      const created = await tenants.createWorkspace({
        name: 'Acme Furniture',
        industryProfile: 'furniture',
        owner: owner('olivia@acme.test'),
        currency: 'PKR',
        timezone: 'Asia/Karachi',
      });
      ({ workspaceId, ownerUserId, membershipId } = created);
      expect(created.slug).toBe('acme-furniture');
    });

    it('creates the workspace with a complete config adjusted by the furniture profile', async () => {
      const ws = await prisma().workspace.findUniqueOrThrow({ where: { id: workspaceId } });
      expect(ws).toMatchObject({
        name: 'Acme Furniture',
        industryProfile: 'furniture',
        status: 'ACTIVE',
      });
      const config = ws.config as Json;
      expect(Object.keys(config).sort()).toEqual(
        [
          'ai',
          'branding',
          'business',
          'commission',
          'documents',
          'duplicates',
          'inventory',
          'locale',
          'messaging',
          'modules',
          'numbering',
          'pos',
          'retention',
          'sales',
          'tax',
          'terminology',
        ].sort(),
      );
      expect(config.locale).toMatchObject({ currency: 'PKR', timezone: 'Asia/Karachi' });
      expect(config.terminology.productionJob).toEqual({
        singular: 'Workshop Job',
        plural: 'Workshop Jobs',
      });
      expect(config.modules).toMatchObject({ pos: true, production: true, automation: false });
      expect(config.sales.requiredDepositPercent).toBe(50);
      expect(Object.keys(config.numbering).sort()).toEqual([...DOCUMENT_TYPES].sort());
    });

    it('creates the nine system roles with the designed permissions and discount limits', async () => {
      const roles = await prisma().role.findMany({
        where: { workspaceId },
        orderBy: { name: 'asc' },
      });
      expect(roles).toHaveLength(9);
      for (const def of DEFAULT_ROLES) {
        const role = roles.find((r) => r.name === def.name);
        expect(role).toBeDefined();
        expect([...(role?.permissions ?? [])].sort()).toEqual([...def.permissions].sort());
        expect(Number(role?.maxDiscountPercent)).toBe(def.maxDiscountPercent);
        expect(role?.isSystem).toBe(true);
        expect(role?.isOwner).toBe(def.isOwner);
      }
    });

    it('makes the creator the Owner and lets them log in with every permission', async () => {
      const membership = await prisma().userWorkspace.findUniqueOrThrow({
        where: { id: membershipId },
        include: { roles: { include: { role: true } } },
      });
      expect(membership.userId).toBe(ownerUserId);
      expect(membership.roles.map((r) => r.role.name)).toEqual(['Owner']);

      const res = await api(t.app)
        .post('/auth/login', { email: 'olivia@acme.test', password: 'owner-password-1' })
        .expect(200);
      const claims = bearerPayload(res.body.data.accessToken);
      expect(claims.tenantId).toBe(workspaceId);
      expect((claims.permissions as string[]).sort()).toEqual([...WORKSPACE_PERMISSIONS].sort());
    });

    it('applies the furniture profile: fields, four workflows, units', async () => {
      const counts = await countRows(workspaceId);
      expect(counts).toMatchObject({ fields: 47, workflows: 4, units: 12 });
      expect(counts.states).toBe(10 + 7 + 5 + 4);
      expect(counts.transitions).toBeGreaterThan(40);

      const order = await prisma().workflow.findUniqueOrThrow({
        where: { workspaceId_entityType: { workspaceId, entityType: 'ORDER' } },
        include: { states: true, transitions: true },
      });
      const roles = order.states.map((s) => s.systemRole).filter(Boolean);
      expect(roles).toEqual(
        expect.arrayContaining([
          'DRAFT',
          'CONFIRMED',
          'IN_PRODUCTION',
          'READY',
          'DELIVERED',
          'COMPLETED',
          'CANCELLED',
          'ON_HOLD',
        ]),
      );
      expect(order.states.filter((s) => s.isInitial).map((s) => s.key)).toEqual(['draft']);
      const stateIds = new Set(order.states.map((s) => s.id));
      expect(
        order.transitions.every((x) => stateIds.has(x.fromStateId) && stateIds.has(x.toStateId)),
      ).toBe(true);

      const length = await prisma().fieldDefinition.findFirstOrThrow({
        where: { workspaceId, entityType: 'ORDER_ITEM', key: 'length' },
      });
      expect(length).toMatchObject({
        type: 'MEASUREMENT',
        unitDimension: 'length',
        isSystem: true,
      });
      expect(length.visibleWhen).toMatchObject({
        source: 'field',
        key: 'size_type',
        op: 'eq',
        value: 'custom',
      });
    });

    it('creates one default location, the numbering sequences and an audit event', async () => {
      const locations = await prisma().inventoryLocation.findMany({ where: { workspaceId } });
      expect(locations).toHaveLength(1);
      expect(locations[0]?.isDefault).toBe(true);
      const ws = await prisma().workspace.findUniqueOrThrow({ where: { id: workspaceId } });
      expect((ws.config as Json).inventory.defaultLocationId).toBe(locations[0]?.id);
      const membership = await prisma().userWorkspace.findUniqueOrThrow({
        where: { id: membershipId },
      });
      expect(membership.defaultLocationId).toBe(locations[0]?.id);

      const sequences = await prisma().documentSequence.findMany({ where: { workspaceId } });
      expect(sequences.map((s) => s.docType).sort()).toEqual([...DOCUMENT_TYPES].sort());
      expect(sequences.every((s) => s.nextValue === 1)).toBe(true);

      const events = await prisma().auditEvent.findMany({
        where: { workspaceId, action: 'workspace.create' },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ entityId: workspaceId, actorUserId: ownerUserId });
    });

    it('applying the profile again changes nothing', async () => {
      const before = await countRows(workspaceId);
      const configBefore = await prisma().workspace.findUniqueOrThrow({
        where: { id: workspaceId },
      });
      const result = await profiles.apply(workspaceId, 'furniture');
      expect(result).toMatchObject({
        fieldDefinitions: 0,
        workflows: 0,
        states: 0,
        transitions: 0,
        units: 0,
        terminologyChanged: false,
        modulesChanged: false,
      });
      expect(await countRows(workspaceId)).toEqual(before);
      const configAfter = await prisma().workspace.findUniqueOrThrow({
        where: { id: workspaceId },
      });
      expect(configAfter.config).toEqual(configBefore.config);
      expect(configAfter.configVersion).toBe(configBefore.configVersion);
    });

    it('applying the profile never deletes or overwrites what the business changed or added', async () => {
      await prisma().fieldDefinition.update({
        where: {
          workspaceId_entityType_key: { workspaceId, entityType: 'ORDER_ITEM', key: 'color' },
        },
        data: { label: 'Finish colour', active: false },
      });
      const custom = await prisma().fieldDefinition.create({
        data: { workspaceId, entityType: 'LEAD', key: 'budget', label: 'Budget', type: 'CURRENCY' },
      });
      const orderWf = await prisma().workflow.findUniqueOrThrow({
        where: { workspaceId_entityType: { workspaceId, entityType: 'ORDER' } },
      });
      await prisma().workflowState.update({
        where: {
          workspaceId_workflowId_key: { workspaceId, workflowId: orderWf.id, key: 'in_production' },
        },
        data: { label: 'In workshop' },
      });
      const extra = await prisma().workflowState.create({
        data: {
          workspaceId,
          workflowId: orderWf.id,
          key: 'awaiting_fabric',
          label: 'Awaiting fabric',
          category: 'IN_PROGRESS',
        },
      });
      const ws = await prisma().workspace.findUniqueOrThrow({ where: { id: workspaceId } });
      const config = ws.config as Json;
      config.terminology.customer = { singular: 'Client', plural: 'Clients' };
      config.modules.pos = false;
      await prisma().workspace.update({ where: { id: workspaceId }, data: { config } });

      await profiles.apply(workspaceId, 'furniture');

      expect(
        (await prisma().fieldDefinition.findUniqueOrThrow({ where: { id: custom.id } })).key,
      ).toBe('budget');
      expect(
        await prisma().fieldDefinition.findFirstOrThrow({
          where: { workspaceId, entityType: 'ORDER_ITEM', key: 'color' },
        }),
      ).toMatchObject({ label: 'Finish colour', active: false });
      expect(
        (await prisma().workflowState.findUniqueOrThrow({ where: { id: extra.id } })).label,
      ).toBe('Awaiting fabric');
      expect(
        await prisma().workflowState.findFirstOrThrow({
          where: { workflowId: orderWf.id, key: 'in_production' },
        }),
      ).toMatchObject({ label: 'In workshop' });
      const after = (await prisma().workspace.findUniqueOrThrow({ where: { id: workspaceId } }))
        .config as Json;
      expect(after.terminology.customer).toEqual({ singular: 'Client', plural: 'Clients' });
      expect(after.modules.pos).toBe(false);
    });
  });

  describe('isolation between workspaces', () => {
    it('two businesses get their own copy of every default, with no clashes', async () => {
      const a = await tenants.createWorkspace({
        name: 'Same Name',
        industryProfile: 'furniture',
        owner: owner('a@same.test'),
      });
      const b = await tenants.createWorkspace({
        name: 'Same Name',
        industryProfile: 'furniture',
        owner: owner('b@same.test'),
      });
      expect(a.slug).toBe('same-name');
      expect(b.slug).toBe('same-name-2');
      expect(await countRows(a.workspaceId)).toEqual(await countRows(b.workspaceId));
      const ids = await prisma().role.findMany({
        where: { workspaceId: { in: [a.workspaceId, b.workspaceId] } },
        select: { id: true },
      });
      expect(new Set(ids.map((r) => r.id)).size).toBe(18);
    });

    it('an existing user can own a second workspace without changing their password', async () => {
      const first = await tenants.createWorkspace({
        name: 'First Co',
        industryProfile: 'furniture',
        owner: owner('multi@owner.test'),
      });
      const before = await prisma().user.findUniqueOrThrow({ where: { id: first.ownerUserId } });
      const second = await tenants.createWorkspace({
        name: 'Second Co',
        industryProfile: 'furniture',
        owner: { ...owner('MULTI@owner.test'), password: 'a-different-password-9' },
      });
      expect(second.ownerUserId).toBe(first.ownerUserId);
      const after = await prisma().user.findUniqueOrThrow({ where: { id: first.ownerUserId } });
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(await prisma().userWorkspace.count({ where: { userId: first.ownerUserId } })).toBe(2);
    });
  });

  describe('extension points for later modules', () => {
    it('runs registered workspace defaults and profile sections inside the creating transaction', async () => {
      const seen: string[] = [];
      defaults.register('test-walk-in', async (tx, ctx) => {
        seen.push(`defaults:${ctx.workspaceId}`);
        await tx.note.create({
          data: {
            workspaceId: ctx.workspaceId,
            entityType: 'CUSTOMER',
            entityId: 'walk-in',
            body: 'walk-in',
          },
        });
      });
      sections.register('lostReasons', async (tx, workspaceId, items) => {
        seen.push(`lostReasons:${(items as string[]).length}`);
        await tx.note.create({
          data: {
            workspaceId,
            entityType: 'CUSTOMER',
            entityId: 'reasons',
            body: (items as string[]).join('|'),
          },
        });
      });
      const created = await tenants.createWorkspace({
        name: 'Plugged',
        industryProfile: 'furniture',
        owner: owner('plug@in.test'),
      });
      expect(seen).toEqual([`lostReasons:7`, `defaults:${created.workspaceId}`]);
      expect(await prisma().note.count({ where: { workspaceId: created.workspaceId } })).toBe(2);
    });

    it('a failure in any part leaves nothing behind', async () => {
      defaults.register('test-explode', async () => {
        throw new Error('boom');
      });
      await expect(
        tenants.createWorkspace({
          name: 'Doomed',
          industryProfile: 'furniture',
          owner: owner('doomed@x.test'),
        }),
      ).rejects.toThrow('boom');
      expect(await prisma().workspace.count({ where: { name: 'Doomed' } })).toBe(0);
      expect(await prisma().user.count({ where: { email: 'doomed@x.test' } })).toBe(0);
      expect(await prisma().role.count({ where: { workspace: { name: 'Doomed' } } })).toBe(0);
    });
  });

  describe('validation', () => {
    it('rejects a weak owner password and an unknown profile', async () => {
      await expect(
        tenants.createWorkspace({
          name: 'Weak',
          industryProfile: 'furniture',
          owner: { ...owner('weak@x.test'), password: 'short' },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        tenants.createWorkspace({
          name: 'Nope',
          industryProfile: 'spaceships',
          owner: owner('nope@x.test'),
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await prisma().workspace.count({ where: { name: { in: ['Weak', 'Nope'] } } })).toBe(0);
    });

    it('lists the active profiles', async () => {
      expect((await profiles.list()).map((p) => p.key)).toContain('furniture');
    });
  });
});

describe('POST /tenants (Requirement 46.4)', () => {
  const body = { name: 'Via API', industryProfile: 'furniture', owner: owner('api@owner.test') };

  it('is refused by default and without a Platform_Admin token', async () => {
    const t = await createTestApp();
    try {
      const http = api(t.app);
      const res = await http.post('/tenants', body).expect(403);
      expect(res.body.code).toBe('PERMISSION_DENIED');
      const user = await seedUser(t.db.prisma, t.app.get(PasswordService), 'ws_x');
      const token = t.app.get(TokenService).signAccessToken({
        sub: user.userId,
        tenantId: 'ws_x',
        mid: user.membershipId,
        permissions: [],
        pv: 1,
        fam: 'f',
      });
      await http.post('/tenants', body, token).expect(403); // an ordinary user is not enough
      expect(await t.db.prisma.workspace.count({ where: { name: 'Via API' } })).toBe(0);
    } finally {
      await t.close();
    }
  }, 60_000);

  it('is allowed for a Platform_Admin', async () => {
    const t = await createTestApp();
    try {
      const admin = await seedUser(t.db.prisma, t.app.get(PasswordService), 'ws_admin');
      await t.db.prisma.user.update({
        where: { id: admin.userId },
        data: { isPlatformAdmin: true },
      });
      const token = t.app.get(TokenService).signAccessToken({
        sub: admin.userId,
        tenantId: 'ws_admin',
        mid: admin.membershipId,
        permissions: [],
        pv: 1,
        fam: 'f',
      });
      const res = await api(t.app).post('/tenants', body, token).expect(201);
      expect(res.body.data.workspace).toMatchObject({ name: 'Via API', slug: 'via-api' });
      expect(res.body.data.owner.email).toBe('api@owner.test');
      expect(JSON.stringify(res.body)).not.toContain('owner-password-1');
    } finally {
      await t.close();
    }
  }, 60_000);

  it('is open when public signup is enabled, and validates input', async () => {
    const t = await createTestApp({ ALLOW_PUBLIC_SIGNUP: true });
    try {
      const http = api(t.app);
      await http.post('/tenants', { ...body, name: '' }).expect(400);
      await http.post('/tenants', { ...body, extra: 1 }).expect(400);
      await http
        .post('/tenants', { ...body, owner: { ...body.owner, password: 'short' } })
        .expect(400);
      await http.post('/tenants', body).expect(201);
      const login = await http
        .post('/auth/login', { email: 'api@owner.test', password: 'owner-password-1' })
        .expect(200);
      expect(login.body.data.requiresWorkspaceSelection).toBe(false);
    } finally {
      await t.close();
    }
  }, 60_000);
});
