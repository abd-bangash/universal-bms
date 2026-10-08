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
import { DEMO_LEADS } from '../src/seed/steps/crm.data';
import { DEMO_STAFF } from '../src/seed/steps/staff.step';

const DEMO_LEADS_WITH_FOLLOW_UP = DEMO_LEADS.filter(
  (l) => l.nextAction && l.followUpInDays !== undefined && l.stage !== 'won' && l.stage !== 'lost',
).length;
import { api, bearerPayload, createTestApp, type TestApp } from './helpers/auth-app';

describe('seed:demo (Requirements 50.2, 50.3)', () => {
  let t: TestApp;
  const services = () => ({
    prisma: t.app.get(PrismaService),
    tenants: t.app.get(TenantsService),
    passwords: t.app.get(PasswordService),
    get: <T>(token: abstract new (...args: never[]) => T): T => t.app.get(token),
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
      { name: 'catalog', created: 30, existing: 0 },
      { name: 'crm', created: 35, existing: 0 },
      { name: 'inventory', created: 43, existing: 0 },
      { name: 'sales', created: 25, existing: 0 },
      { name: 'finance', created: 21, existing: 0 },
      { name: 'purchasing', created: 10, existing: 0 },
      { name: 'commissions', created: 2, existing: 0 },
    ]);
    expect(logs).toHaveLength(9);

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

  it('seeds a sample catalog: 6+ categories, 30 products with variants, attributes, aliases and images (21)', async () => {
    const workspaceId = (
      await t.db.prisma.workspace.findUniqueOrThrow({ where: { slug: DEMO_WORKSPACE.slug } })
    ).id;
    const roots = await t.db.prisma.category.count({ where: { workspaceId, parentId: null } });
    expect(roots).toBeGreaterThanOrEqual(6);

    const products = await t.db.prisma.product.findMany({
      where: { workspaceId },
      include: { variants: true, images: { include: { file: true } }, category: true },
    });
    expect(products).toHaveLength(30);
    for (const p of products) {
      expect(p.status).toBe('ACTIVE');
      expect(p.category?.parentId).not.toBeNull();
      expect(p.variants.length).toBeGreaterThanOrEqual(1);
      expect(p.variants.filter((v) => v.isDefault)).toHaveLength(1);
      expect(p.aliases.length).toBeGreaterThanOrEqual(1);
      expect(p.images).toHaveLength(1);
      expect(p.images[0]?.isPrimary).toBe(true);
      expect(p.images[0]?.file.mimeType).toBe('image/png');
      const fields = p.customFields as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(fields.width).toMatchObject({ unit: 'cm' });
      expect(typeof fields.material).toBe('string');
      expect(Number(p.basePrice)).toBeGreaterThan(Number(p.costPrice));
    }
    expect(products.reduce((n, p) => n + p.variants.length, 0)).toBeGreaterThan(30);
    expect(products.some((p) => p.madeToOrder)).toBe(true);
    const barcodes = products.flatMap((p) => p.variants.map((v) => v.barcode));
    expect(new Set(barcodes).size).toBe(barcodes.length);

    // the demo owner sees it all through the real API, and a search by alias finds a product
    const http = api(t.app);
    const login = await http
      .post('/auth/login', { email: 'owner@demo.test', password: 'demo-password-1' })
      .expect(200);
    const token = login.body.data.accessToken as string;
    const hits = await http.get('/catalog/variants/search?q=almari', token).expect(200);
    expect((hits.body.data as Array<{ productCode: string }>).map((h) => h.productCode)).toContain(
      'STO-001',
    );
    const salesperson = await http
      .post('/auth/login', { email: 'salesperson@demo.test', password: 'demo-password-1' })
      .expect(200);
    const asSales = await http
      .get('/catalog/products?limit=5', salesperson.body.data.accessToken)
      .expect(200);
    expect(JSON.stringify(asSales.body.data)).not.toMatch(/costPrice|costOverride/);
  });

  it('seeds 20 customers and 15 leads across the pipeline, with history, follow-ups and conversions (30)', async () => {
    const workspaceId = (
      await t.db.prisma.workspace.findUniqueOrThrow({ where: { slug: DEMO_WORKSPACE.slug } })
    ).id;
    const customers = await t.db.prisma.customer.findMany({
      where: { workspaceId, isWalkIn: false },
    });
    expect(customers).toHaveLength(22); // 20 seeded + 2 created by converting won leads
    expect(customers.filter((c) => c.phonesNormalized.length > 0)).toHaveLength(22);
    expect(new Set(customers.flatMap((c) => c.phonesNormalized)).size).toBe(
      customers.flatMap((c) => c.phonesNormalized).length,
    );
    expect(customers.filter((c) => c.assignedToId).length).toBeGreaterThan(5);
    expect(await t.db.prisma.customer.count({ where: { workspaceId, isWalkIn: true } })).toBe(1);

    const leads = await t.db.prisma.lead.findMany({ where: { workspaceId } });
    const byStage = Object.fromEntries(
      ['new', 'contacted', 'qualified', 'quoted', 'negotiation', 'won', 'lost'].map((s) => [
        s,
        leads.filter((l) => l.stage === s).length,
      ]),
    );
    expect(byStage).toEqual({
      new: 2,
      contacted: 2,
      qualified: 2,
      quoted: 2,
      negotiation: 2,
      won: 2,
      lost: 3,
    });
    expect(leads.filter((l) => l.stage === 'lost').every((l) => l.lostReasonId && l.closedAt)).toBe(
      true,
    );
    expect(leads.filter((l) => l.stage === 'won').every((l) => l.customerId && l.closedAt)).toBe(
      true,
    );
    expect(leads.filter((l) => l.productId).length).toBeGreaterThan(10);
    expect(
      leads.some((l) => (l.customFields as Record<string, unknown>).size_type === 'custom'),
    ).toBe(true);
    expect(leads.filter((l) => l.assignedToId).length).toBeGreaterThan(8);

    // every stage change has a history row, in order
    const lost = leads.find((l) => l.fullName === 'Palwasha Khan');
    const history = await t.db.prisma.statusHistory.findMany({
      where: { workspaceId, entityId: lost?.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => h.toKey)).toEqual(['new', 'contacted', 'lost']);
    const timeline = await t.db.prisma.timelineEntry.findMany({
      where: { workspaceId, leadId: lost?.id },
    });
    expect(timeline.map((e) => e.summary)).toEqual(
      expect.arrayContaining([
        'Lead created',
        'Stage changed from New to Contacted',
        'Stage changed from Contacted to Lost',
      ]),
    );

    // leads with a next action have one open follow-up task, except those that were closed
    const open = await t.db.prisma.task.count({
      where: { workspaceId, type: 'FOLLOW_UP', status: 'OPEN' },
    });
    expect(open).toBe(DEMO_LEADS_WITH_FOLLOW_UP);
  });

  it('seeds 10 quotations and 15 orders across every status, with genuine history (38)', async () => {
    const workspaceId = (
      await t.db.prisma.workspace.findUniqueOrThrow({ where: { slug: DEMO_WORKSPACE.slug } })
    ).id;
    const quotations = await t.db.prisma.quotation.findMany({
      where: { workspaceId },
      include: { items: true },
    });
    const count = (status: string) => quotations.filter((q) => q.status === status).length;
    expect(quotations).toHaveLength(10);
    expect({
      DRAFT: count('DRAFT'),
      SENT: count('SENT'),
      ACCEPTED: count('ACCEPTED'),
      REJECTED: count('REJECTED'),
      EXPIRED: count('EXPIRED'),
      CONVERTED: count('CONVERTED'),
    }).toEqual({ DRAFT: 3, SENT: 2, ACCEPTED: 1, REJECTED: 1, EXPIRED: 1, CONVERTED: 2 });
    expect(quotations.every((q) => q.items.length > 0 && Number(q.totalAmount) > 0)).toBe(true);
    // a custom sofa line carries its measurements
    expect(
      quotations
        .flatMap((q) => q.items)
        .some((i) => i.kind === 'CUSTOM' && (i.fieldSnapshot as unknown[]).length >= 3),
    ).toBe(true);

    // the 15 seeded orders plus the 2 made by converting quotations
    const orders = await t.db.prisma.order.findMany({ where: { workspaceId } });
    expect(orders).toHaveLength(17);
    const seeded = orders.filter((o) => o.campaign?.startsWith('demo-seed-o'));
    const statusCount = (status: string) => seeded.filter((o) => o.status === status).length;
    expect({
      draft: statusCount('draft'),
      confirmed: statusCount('confirmed'),
      deposit_paid: statusCount('deposit_paid'),
      in_production: statusCount('in_production'),
      ready: statusCount('ready'),
      delivered: statusCount('delivered'),
      completed: statusCount('completed'),
      on_hold: statusCount('on_hold'),
      cancelled: statusCount('cancelled'),
    }).toEqual({
      draft: 3,
      confirmed: 2,
      deposit_paid: 1, // o5 reached its required deposit
      in_production: 2,
      ready: 1,
      delivered: 2,
      completed: 2,
      on_hold: 1,
      cancelled: 1,
    });
    expect(seeded.filter((o) => o.status === 'cancelled').every((o) => o.cancelReason)).toBe(true);
    expect(seeded.filter((o) => o.status === 'completed').every((o) => o.closedAt)).toBe(true);
    // delivered orders raised their invoice automatically
    expect(await t.db.prisma.invoice.count({ where: { workspaceId } })).toBeGreaterThanOrEqual(4);
    const history = await t.db.prisma.statusHistory.findMany({
      where: { workspaceId, entityId: seeded.find((o) => o.status === 'completed')?.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => h.toKey)).toEqual([
      'draft',
      'confirmed',
      'in_production',
      'ready',
      'out_for_delivery',
      'delivered',
      'completed',
    ]);
  });

  it('seeds payments in every state and ten expenses, with balances that add up (44)', async () => {
    const workspaceId = (
      await t.db.prisma.workspace.findUniqueOrThrow({ where: { slug: DEMO_WORKSPACE.slug } })
    ).id;
    const payments = await t.db.prisma.payment.findMany({ where: { workspaceId } });
    const byStatus = (s: string) => payments.filter((p) => p.status === s).length;
    expect(byStatus('PENDING_VERIFICATION')).toBe(1);
    expect(byStatus('VOIDED')).toBe(1);
    expect(byStatus('CONFIRMED')).toBeGreaterThanOrEqual(9);
    // an advance became credit
    const credit = await t.db.prisma.customerCredit.aggregate({
      where: { workspaceId },
      _sum: { amount: true },
    });
    expect(Number(credit._sum.amount)).toBe(25000);
    // every order's stored balance equals what its confirmed payments say
    const orders = await t.db.prisma.order.findMany({ where: { workspaceId } });
    for (const order of orders) {
      const confirmed = payments.filter(
        (p) => p.orderId === order.id && p.status === 'CONFIRMED' && p.type !== 'ADVANCE',
      );
      const paid = confirmed.reduce((a, p) => a + Number(p.amount), 0);
      expect(Number(order.paidAmount)).toBeCloseTo(paid, 2);
      expect(Number(order.balanceDue)).toBeCloseTo(Number(order.totalAmount) - paid, 2);
    }
    const paidOff = orders.filter((o) => o.paymentStatus === 'PAID');
    expect(paidOff.length).toBeGreaterThanOrEqual(3);
    expect(orders.some((o) => o.paymentStatus === 'DEPOSIT_PAID')).toBe(true);
    expect(orders.some((o) => o.paymentStatus === 'PARTIALLY_PAID')).toBe(true);
    expect(await t.db.prisma.receipt.count({ where: { workspaceId } })).toBeGreaterThanOrEqual(9);

    const expenses = await t.db.prisma.expense.findMany({ where: { workspaceId } });
    expect(expenses).toHaveLength(10);
    expect(new Set(expenses.map((e) => e.categoryId)).size).toBeGreaterThanOrEqual(6);
    expect(expenses.every((e) => e.status === 'POSTED' && Number(e.amount) > 0)).toBe(true);
  });

  it('seeds opening stock for every stockable variant, with some low and some over (49)', async () => {
    const workspaceId = (
      await t.db.prisma.workspace.findUniqueOrThrow({ where: { slug: DEMO_WORKSPACE.slug } })
    ).id;
    const variants = await t.db.prisma.productVariant.count({
      where: { workspaceId, status: 'ACTIVE', product: { type: 'STOCKABLE', madeToOrder: false } },
    });
    const opening = await t.db.prisma.stockMovement.count({
      where: { workspaceId, movementType: 'OPENING_STOCK' },
    });
    expect(opening).toBe(variants);
    const levels = await t.db.prisma.stockLevel.findMany({
      where: { workspaceId },
      include: { variant: true },
    });
    // the stored level equals the ledger for every variant (Property 5), reservations equal the active ones
    for (const level of levels) {
      const ledger = await t.db.prisma.stockMovement.aggregate({
        where: { workspaceId, variantId: level.variantId, locationId: level.locationId },
        _sum: { quantityDelta: true },
      });
      expect(level.onHand.toFixed()).toBe(ledger._sum.quantityDelta?.toFixed());
      const active = await t.db.prisma.stockReservation.aggregate({
        where: {
          workspaceId,
          variantId: level.variantId,
          locationId: level.locationId,
          status: 'ACTIVE',
        },
        _sum: { quantity: true },
      });
      expect(level.reserved.toFixed()).toBe(
        (active._sum.quantity ?? 0).toString() === '0' ? '0' : active._sum.quantity?.toFixed(),
      );
    }
    const low = levels.filter(
      (l) => l.variant.minStockLevel && l.onHand.minus(l.reserved).lt(l.variant.minStockLevel),
    );
    expect(low.length).toBeGreaterThan(0);
    expect(
      levels.some((l) => l.variant.maxStockLevel && l.onHand.gt(l.variant.maxStockLevel)),
    ).toBe(true);
    // the seeded orders that were confirmed hold stock, and delivered ones sold it
    expect(
      await t.db.prisma.stockReservation.count({ where: { workspaceId, status: 'ACTIVE' } }),
    ).toBeGreaterThan(0);
    expect(
      await t.db.prisma.stockMovement.count({ where: { workspaceId, movementType: 'SALE' } }),
    ).toBeGreaterThan(0);

    // commission settings for the people who sell, and the commissions the completed orders earned
    expect(
      await t.db.prisma.commissionRule.findMany({
        where: { workspaceId, name: 'Staff commission', active: true },
        orderBy: { rate: 'asc' },
      }),
    ).toHaveLength(3);
    const earned = await t.db.prisma.commission.findMany({ where: { workspaceId } });
    expect(earned.map((c) => c.status).sort()).toEqual(['PAID', 'PENDING']);

    // 5 suppliers and 5 purchases in different states, received ones posted to the ledger (50.2)
    expect(await t.db.prisma.supplier.count({ where: { workspaceId } })).toBe(5);
    const purchases = await t.db.prisma.purchaseOrder.findMany({ where: { workspaceId } });
    expect(purchases.map((p) => p.status).sort()).toEqual([
      'draft',
      'partially_received',
      'received',
      'received',
      'sent',
    ]);
    expect(
      await t.db.prisma.stockMovement.count({
        where: { workspaceId, movementType: 'PURCHASE_RECEIPT' },
      }),
    ).toBe(6); // 3 + 2 lines received on the spot, 1 line of the partly received order
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
      { name: 'catalog', created: 0, existing: 30 },
      { name: 'crm', created: 0, existing: 35 },
      { name: 'inventory', created: 0, existing: 43 },
      { name: 'sales', created: 0, existing: 25 },
      { name: 'finance', created: 0, existing: 21 },
      { name: 'purchasing', created: 0, existing: 10 },
      { name: 'commissions', created: 0, existing: 1 },
    ]);
    expect(await t.db.prisma.customer.count({ where: { isWalkIn: false } })).toBe(22); // 20 + 2 from won leads
    expect(await t.db.prisma.lead.count()).toBe(15);
    expect(await t.db.prisma.product.count()).toBe(30);
    expect(await t.db.prisma.productImage.count()).toBe(30);
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
    expect(report.steps.map((s) => s.name)).toEqual([
      'workspace',
      'staff',
      'catalog',
      'crm',
      'inventory',
      'sales',
      'finance',
      'purchasing',
      'commissions',
      'probe',
    ]);
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
