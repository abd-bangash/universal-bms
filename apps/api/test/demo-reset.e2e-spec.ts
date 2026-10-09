import { DEFAULT_ROLES } from '@bms/types';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TENANT_MODELS } from '../src/common/prisma/tenant-models';
import { PasswordService } from '../src/modules/auth/password.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import {
  DEMO_WORKSPACE,
  runDemoSeed,
  assertSeedAllowed,
  SeedRefusedError,
} from '../src/seed/demo-seed';
import {
  clearDemoRecords,
  CONFIGURATION_MODELS,
  deletionOrder,
  wipeWorkspace,
} from '../src/seed/demo-reset';
import { DEMO_STEPS } from '../src/seed/steps';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Demo data and reset (Requirements 50.2 to 50.6)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let prisma: PrismaService;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
    prisma = t.app.get(PrismaService);
  }, 90_000);
  afterAll(() => t.close());

  const seed = () =>
    runDemoSeed(
      {
        prisma,
        tenants: t.app.get(TenantsService),
        passwords: t.app.get(PasswordService),
        get: <T>(token: abstract new (...args: never[]) => T): T => t.app.get(token),
      },
      DEMO_STEPS,
      { password: 'demo-password-1', resetPasswords: true },
    );
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  const rows = async (workspaceId: string): Promise<Record<string, number>> => {
    const client = t.db.prisma as unknown as Record<string, { count(a: unknown): Promise<number> }>;
    const out: Record<string, number> = {};
    for (const model of new Set(TENANT_MODELS))
      out[model] = await client[lower(model)]!.count({ where: { workspaceId } }).catch(() => -1);
    return out;
  };

  it('every tenant model is classified: either a record that goes at go-live or configuration that stays', () => {
    const order = deletionOrder(
      [...new Set(TENANT_MODELS)].filter((m) => !CONFIGURATION_MODELS.has(m)),
    );
    expect(order.length).toBeGreaterThan(40);
    // rows that point at others are deleted first
    expect(order.indexOf('OrderItem')).toBeLessThan(order.indexOf('Order'));
    expect(order.indexOf('Order')).toBeLessThan(order.indexOf('Customer'));
    expect(order.indexOf('Message')).toBeLessThan(order.indexOf('Conversation'));
    expect(order.indexOf('ProductVariant')).toBeLessThan(order.indexOf('Product'));
    for (const kept of CONFIGURATION_MODELS)
      expect([kept, order.includes(kept)]).toEqual([kept, false]);
  });

  describe('the full dataset (Requirement 50.2)', () => {
    let workspaceId: string;
    beforeAll(async () => {
      workspaceId = (await seed()).workspaceId;
    }, 180_000);

    it('has everything the requirement lists', async () => {
      const count = async (model: string, where: object = {}) =>
        (t.db.prisma as unknown as Record<string, { count(a: unknown): Promise<number> }>)[
          model
        ]!.count({ where: { workspaceId, ...where } });
      expect(await count('category')).toBeGreaterThanOrEqual(6);
      expect(await count('product')).toBeGreaterThanOrEqual(30);
      expect(await count('productVariant')).toBeGreaterThanOrEqual(30);
      expect(await count('productImage')).toBeGreaterThanOrEqual(30);
      expect(await count('inventoryLocation')).toBeGreaterThanOrEqual(1);
      expect(await count('stockMovement', { movementType: 'OPENING_STOCK' })).toBeGreaterThan(0);
      expect(await count('customer', { isWalkIn: false })).toBeGreaterThanOrEqual(20);
      expect(await count('lead')).toBeGreaterThanOrEqual(15);
      expect(
        (await t.db.prisma.lead.groupBy({ by: ['stage'], where: { workspaceId } })).length,
      ).toBeGreaterThanOrEqual(5);
      expect(await count('quotation')).toBeGreaterThanOrEqual(10);
      expect(await count('order')).toBeGreaterThanOrEqual(15);
      expect(
        (await t.db.prisma.order.groupBy({ by: ['status'], where: { workspaceId } })).length,
      ).toBeGreaterThanOrEqual(5);
      expect(await count('payment')).toBeGreaterThan(0);
      expect(await count('supplier')).toBeGreaterThanOrEqual(5);
      expect(await count('purchaseOrder')).toBeGreaterThanOrEqual(5);
      expect(await count('expense')).toBeGreaterThanOrEqual(10);
      expect(await count('conversation')).toBeGreaterThanOrEqual(10);
      expect(await count('knowledgeItem')).toBeGreaterThanOrEqual(5);
      expect(await count('messageTemplate')).toBeGreaterThanOrEqual(5);
    });

    it('has one staff user for each default role, with commission settings for the people who sell', async () => {
      const members = await t.db.prisma.userWorkspace.findMany({
        where: { workspaceId },
        include: { roles: { include: { role: true } }, user: true },
      });
      const roleNames = members.flatMap((m) => m.roles.map((r) => r.role.name));
      expect([...new Set(roleNames)].sort()).toEqual(DEFAULT_ROLES.map((r) => r.name).sort());
      expect(members.every((m) => m.user.email.endsWith('@demo.test'))).toBe(true); // synthetic, no real person (Requirement 50.5)
      expect(
        await t.db.prisma.commissionRule.count({ where: { workspaceId } }),
      ).toBeGreaterThanOrEqual(2);
    });

    it('is synthetic: every customer, lead and supplier uses a reserved or invalid e-mail domain and a fictitious number', async () => {
      const emails = [
        ...(await t.db.prisma.customer.findMany({
          where: { workspaceId, email: { not: null } },
          select: { email: true },
        })),
        ...(await t.db.prisma.lead.findMany({
          where: { workspaceId, email: { not: null } },
          select: { email: true },
        })),
        ...(await t.db.prisma.supplier.findMany({
          where: { workspaceId, email: { not: null } },
          select: { email: true },
        })),
      ].map((r) => r.email as string);
      expect(emails.length).toBeGreaterThan(10);
      expect(
        emails.filter(
          (e) => !/@(example\.(com|org|net|test)|[a-z0-9-]+\.test|[a-z0-9-]+\.example)$/i.test(e),
        ),
      ).toEqual([]);
    });
  });

  describe('clearing the demo records for go-live (Requirement 50.6)', () => {
    let workspaceId: string;
    let before: Record<string, number>;
    beforeAll(async () => {
      await wipeWorkspace(
        prisma,
        (await prisma.unscoped.workspace.findFirstOrThrow({ where: { slug: DEMO_WORKSPACE.slug } }))
          .id,
      );
      workspaceId = (await seed()).workspaceId;
      before = await rows(workspaceId);
    }, 240_000);

    it('removes the business records and keeps the configuration', async () => {
      const report = await clearDemoRecords(prisma, workspaceId);
      const after = await rows(workspaceId);
      for (const model of Object.keys(after)) {
        if (CONFIGURATION_MODELS.has(model)) {
          if (model === 'AuditEvent')
            expect(after[model]).toBe((before[model] as number) + 1); // history stays; the clearing is recorded
          else if (model === 'IntegrationConnection')
            expect(after[model]).toBe(0); // only the placeholder channel existed
          else expect([model, after[model]]).toEqual([model, before[model]]);
        }
      }
      // customers: only the walk-in customer remains; nothing else of the business
      expect(await t.db.prisma.customer.findMany({ where: { workspaceId } })).toHaveLength(1);
      expect(
        (await t.db.prisma.customer.findFirstOrThrow({ where: { workspaceId } })).isWalkIn,
      ).toBe(true);
      for (const model of [
        'Product',
        'ProductVariant',
        'Lead',
        'Quotation',
        'Order',
        'Payment',
        'Expense',
        'Supplier',
        'PurchaseOrder',
        'StockMovement',
        'StockLevel',
        'Invoice',
        'Receipt',
        'Commission',
        'Conversation',
        'Message',
        'Task',
        'Note',
        'Notification',
        'FileAsset',
        'DocumentSequence',
      ]) {
        expect([model, after[model]]).toEqual([model, 0]);
      }
      expect(report.deleted['Order']).toBeGreaterThan(0);
      expect(report.fileKeys.length).toBeGreaterThan(0);
      // the workspace is a real one now, and the clearing is on the record
      expect(
        await t.db.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
      ).toMatchObject({ isDemo: false });
      expect(
        await t.db.prisma.auditEvent.count({
          where: { workspaceId, action: 'workspace.clear_demo' },
        }),
      ).toBe(1);
    });

    it('leaves a workspace that works: people sign in, and the first real records start their numbers from one', async () => {
      const token = (
        await http
          .post('/auth/login', { email: DEMO_WORKSPACE.ownerEmail, password: 'demo-password-1' })
          .expect(200)
      ).body.data.accessToken as string;
      expect(((await http.get('/roles', token)).body.data as Json[]).length).toBe(
        DEFAULT_ROLES.length,
      );
      expect(
        ((await http.get('/settings/payment-methods', token)).body.data as Json[]).length,
      ).toBeGreaterThan(0);
      const customer = (
        await http
          .post('/customers', { fullName: 'First Real Customer', phones: ['+923001234567'] }, token)
          .expect(201)
      ).body.data as Json;
      const product = (
        await http
          .post(
            '/catalog/products',
            {
              type: 'NON_STOCKABLE',
              code: 'REAL-1',
              name: 'Real product',
              basePrice: '1000',
              variants: [{ sku: 'REAL-1' }],
            },
            token,
          )
          .expect(201)
      ).body.data as Json;
      const order = await request(t.app.getHttpServer())
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', '10.31.0.1')
        .set('Idempotency-Key', 'first-real-order')
        .send({
          customerId: customer.id,
          lines: [{ variantId: product.variants[0].id, quantity: '1' }],
        });
      expect(order.status).toBe(201);
      expect(order.body.data.orderNumber).toMatch(/-0*1$/);
      expect(
        ((await http.get('/customers', token)).body.data as Json[]).map((c) => c.fullName),
      ).toContain('First Real Customer');
    });

    it('is refused for a workspace that is not a demo', async () => {
      await expect(clearDemoRecords(prisma, workspaceId)).rejects.toThrow(/not marked as a demo/);
      await expect(wipeWorkspace(prisma, workspaceId)).rejects.toThrow(/not marked as a demo/);
      await expect(clearDemoRecords(prisma, 'nope')).rejects.toThrow(/does not exist/);
    });

    it('lifts the protection of the audit log, the stock ledger and invoices only for the length of the operation', async () => {
      // the previous steps ran with it lifted; it is back
      const event = await t.db.prisma.auditEvent.findFirstOrThrow({ where: { workspaceId } });
      await expect(t.db.prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(
        /append-only/,
      );
      await expect(
        t.db.prisma.auditEvent.update({ where: { id: event.id }, data: { action: 'x' } }),
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('resetting the demo workspace (Requirement 50.4)', () => {
    it('removes everything, including what people added since, and builds the seeded state again', async () => {
      // start from nothing: the workspace left by the go-live test above is demo-marked again, then wiped
      const left = await prisma.unscoped.workspace.findFirst({
        where: { slug: DEMO_WORKSPACE.slug },
      });
      if (left) {
        await prisma.unscoped.workspace.update({ where: { id: left.id }, data: { isDemo: true } });
        await wipeWorkspace(prisma, left.id);
      }
      const first = await seed();
      const token = (
        await http
          .post('/auth/login', { email: DEMO_WORKSPACE.ownerEmail, password: 'demo-password-1' })
          .expect(200)
      ).body.data.accessToken as string;
      const seeded = await rows(first.workspaceId);

      // another business next door, which the reset must not touch
      await t.app.get(TenantsService).createWorkspace({
        name: 'Real Business',
        industryProfile: 'furniture',
        owner: {
          email: 'owner@real-business.test',
          firstName: 'R',
          lastName: 'B',
          password: 'owner-password-1',
        },
      });
      const realId = (
        await t.db.prisma.workspace.findFirstOrThrow({ where: { name: 'Real Business' } })
      ).id;
      const realToken = (
        await http
          .post('/auth/login', { email: 'owner@real-business.test', password: 'owner-password-1' })
          .expect(200)
      ).body.data.accessToken as string;
      await http
        .post('/customers', { fullName: 'Real Customer', phones: ['+923009876543'] }, realToken)
        .expect(201);
      const realBefore = await rows(realId);

      // someone adds data to the demo, and changes a setting
      await http
        .post(
          '/customers',
          { fullName: 'Added After Seeding', phones: [`+9230055500${++n}0`] },
          token,
        )
        .expect(201);
      await http.patch('/settings', { sales: { requiredDepositPercent: 10 } }, token).expect(200);

      const demoUserIds = (
        await t.db.prisma.userWorkspace.findMany({ where: { workspaceId: first.workspaceId } })
      ).map((m) => m.userId);
      expect(
        await t.db.prisma.userSession.count({ where: { userId: { in: demoUserIds } } }),
      ).toBeGreaterThan(0);
      const wiped = await wipeWorkspace(prisma, first.workspaceId);
      expect(wiped.deleted['AuditEvent']).toBeGreaterThan(0);
      expect(await t.db.prisma.workspace.count({ where: { slug: DEMO_WORKSPACE.slug } })).toBe(0);
      expect(await t.db.prisma.user.count({ where: { email: { endsWith: '@demo.test' } } })).toBe(
        0,
      );
      expect(await t.db.prisma.userSession.count({ where: { userId: { in: demoUserIds } } })).toBe(
        0,
      ); // their sessions go with them
      expect(await rows(realId)).toEqual(realBefore);
      expect(await t.db.prisma.user.count({ where: { email: 'owner@real-business.test' } })).toBe(
        1,
      );

      const second = await seed();
      expect(second.workspaceId).not.toBe(first.workspaceId);
      expect(await rows(second.workspaceId)).toEqual({
        ...seeded,
        AuditEvent: expect.any(Number),
        IdempotencyKey: expect.any(Number),
        Notification: expect.any(Number),
        TimelineEntry: expect.any(Number),
        Task: expect.any(Number),
        StatusHistory: expect.any(Number),
      });
      const fresh = (
        await http
          .post('/auth/login', { email: DEMO_WORKSPACE.ownerEmail, password: 'demo-password-1' })
          .expect(200)
      ).body.data.accessToken as string;
      expect(
        ((await http.get('/customers?limit=100', fresh)).body.data as Json[]).map(
          (c) => c.fullName,
        ),
      ).not.toContain('Added After Seeding');
      expect(
        ((await http.get('/settings', fresh)).body.data as Json).config.sales
          .requiredDepositPercent,
      ).toBe(50); // the furniture default again
    }, 300_000);

    it('is refused in production unless the override is given', () => {
      expect(() =>
        assertSeedAllowed({ APP_ENV: 'production', SEED_ALLOW_PRODUCTION: false }),
      ).toThrow(SeedRefusedError);
      expect(() =>
        assertSeedAllowed({ APP_ENV: 'production', SEED_ALLOW_PRODUCTION: true }),
      ).not.toThrow();
      expect(() =>
        assertSeedAllowed({ APP_ENV: 'testing', SEED_ALLOW_PRODUCTION: false }),
      ).not.toThrow();
    });
  });
});
