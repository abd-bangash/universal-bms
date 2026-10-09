import request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TENANT_MODELS } from '../src/common/prisma/tenant-models';
import { PasswordService } from '../src/modules/auth/password.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { runDemoSeed } from '../src/seed/demo-seed';
import { DEMO_STEPS } from '../src/seed/steps';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { listRoutes, type RouteInfo } from './helpers/routes';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

/**
 * The record behind each route that takes an id (longest prefix wins). A route with an id that is
 * not listed here fails the test until someone says what it is, so a new endpoint cannot slip past.
 */
const MODEL_OF_PREFIX: Array<[prefix: string, model: string]> = [
  ['/ai/knowledge', 'KnowledgeItem'],
  ['/ai/suggestions', 'AISuggestion'],
  ['/ai/conversations', 'Conversation'],
  ['/catalog/images', 'ProductImage'],
  ['/catalog/products', 'Product'],
  ['/catalog/brands', 'Brand'],
  ['/catalog/categories', 'Category'],
  ['/catalog/variants', 'ProductVariant'],
  ['/commissions/rules', 'CommissionRule'],
  ['/commissions', 'Commission'],
  ['/conversations', 'Conversation'],
  ['/customers', 'Customer'],
  ['/documents/receipts', 'Receipt'],
  ['/expenses', 'Expense'],
  ['/fields', 'FieldDefinition'],
  ['/files', 'FileAsset'],
  ['/integrations', 'IntegrationConnection'],
  ['/inventory/locations', 'InventoryLocation'],
  ['/invoices', 'Invoice'],
  ['/leads', 'Lead'],
  ['/notifications', 'Notification'],
  ['/orders', 'Order'],
  ['/payments', 'Payment'],
  ['/pos/receipts', 'Receipt'],
  ['/purchases', 'PurchaseOrder'],
  ['/quotations', 'Quotation'],
  ['/roles', 'Role'],
  ['/settings/adjustment-reasons', 'AdjustmentReason'],
  ['/settings/expense-categories', 'ExpenseCategory'],
  ['/settings/financial-accounts', 'FinancialAccount'],
  ['/settings/lost-reasons', 'LostReason'],
  ['/settings/payment-methods', 'PaymentMethod'],
  ['/settings/tax-classes', 'TaxClass'],
  ['/settings/units', 'Unit'],
  ['/suppliers', 'Supplier'],
  ['/tasks', 'Task'],
  ['/templates', 'MessageTemplate'],
  ['/users', 'User'],
  ['/staff', 'User'],
];

/** Routes whose parameter is not the id of something a workspace owns, with the reason. */
const NOT_AN_ID: Array<[prefix: string, why: string]> = [
  ['/reports/', 'the parameter is the name of a report; the data is scoped by the caller'],
  ['/webhooks/', 'the parameter is the provider; checked by signature'],
  ['/workflows/', 'the parameter is the kind of record; workflows are per workspace'],
  ['/settings/apply-profile/', 'the parameter is an industry profile key'],
  ['/auth/sessions', "a person's own sessions; the id is checked against the caller"],
];

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// this test sends far more than a person's 300 requests a minute on purpose (the limit itself is tested in security-review)
process.env['RATE_LIMIT_PER_USER'] = '1000000';

describe('Tenant isolation through the API (Requirement 20.1)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let routes: RouteInfo[];
  let workspaceA: string;
  let workspaceB: string;
  let tokenA: string;
  let tokenB: string;
  let n = 0;
  const idsByModel = new Map<string, string[]>();
  const allIds = new Set<string>();

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
    routes = listRoutes(t.app);
    const seeded = await runDemoSeed(
      {
        prisma: t.app.get(PrismaService),
        tenants: t.app.get(TenantsService),
        passwords: t.app.get(PasswordService),
        get: <T>(token: abstract new (...args: never[]) => T): T => t.app.get(token),
      },
      DEMO_STEPS,
      { password: 'demo-password-1' },
    );
    workspaceA = seeded.workspaceId;
    tokenA = (
      await http
        .post('/auth/login', { email: 'owner@demo.test', password: 'demo-password-1' })
        .expect(200)
    ).body.data.accessToken as string;
    await t.app.get(TenantsService).createWorkspace({
      name: 'Other Business',
      industryProfile: 'furniture',
      owner: {
        email: 'owner@other-business.test',
        firstName: 'O',
        lastName: 'B',
        password: 'owner-password-1',
      },
    });
    workspaceB = (
      await t.db.prisma.workspace.findFirstOrThrow({ where: { name: 'Other Business' } })
    ).id;
    tokenB = (
      await http
        .post('/auth/login', { email: 'owner@other-business.test', password: 'owner-password-1' })
        .expect(200)
    ).body.data.accessToken as string;

    // every id of everything workspace A owns (the sign-in sessions, notifications and so on included)
    const prisma = t.db.prisma as unknown as Record<
      string,
      { findMany(a: unknown): Promise<Array<{ id?: string }>> }
    >;
    for (const model of TENANT_MODELS) {
      const rows = await prisma[lower(model)]!.findMany({
        where: { workspaceId: workspaceA },
        select: { id: true },
        take: 400,
      }).catch(() => []);
      const ids = rows.map((r) => r.id).filter((id): id is string => typeof id === 'string');
      if (ids.length > 0) idsByModel.set(model, ids);
      ids.forEach((id) => allIds.add(id));
    }
    const members = await t.db.prisma.userWorkspace.findMany({
      where: { workspaceId: workspaceA },
      select: { userId: true },
    });
    idsByModel.set(
      'User',
      members.map((m) => m.userId),
    );
    members.forEach((m) => allIds.add(m.userId));
  }, 240_000);
  afterAll(() => t.close());

  const call = (
    r: { method: string; path: string },
    token: string,
    path = r.path.replace(/:\w+/g, 'x'),
    body: object = {},
  ) => {
    const agent = request(t.app.getHttpServer()) as unknown as Record<
      string,
      (p: string) => request.Test
    >;
    return agent[r.method.toLowerCase()]!(path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', `10.${(++n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`)
      .send(body);
  };
  const leaks = (text: string, except?: string): string[] =>
    [...allIds].filter((id) => id !== except && text.includes(id));

  it('has a lot to protect: the demo business has rows in most tenant models', () => {
    expect(allIds.size).toBeGreaterThan(500);
    expect(idsByModel.size).toBeGreaterThan(30);
  });

  it("every list and summary endpoint answers another workspace with none of this one's records", async () => {
    const lists = routes.filter(
      (r) =>
        r.method === 'GET' && !r.path.includes(':') && !r.isPublic && !r.path.endsWith('/local'),
    );
    expect(lists.length).toBeGreaterThan(40);
    const problems: string[] = [];
    for (const r of lists) {
      const res = await call(r, tokenB);
      if (res.status >= 500) problems.push(`${r.path} -> ${res.status}`);
      const found = leaks(res.text);
      if (found.length > 0)
        problems.push(`${r.path} returned ${found.length} of workspace A's ids, e.g. ${found[0]}`);
    }
    expect(problems).toEqual([]);
    // the same endpoints do return data to the owner of A: the test is not passing because everything is empty
    const customers = (await http.get('/customers?limit=5', tokenA).expect(200)).body
      .data as Json[];
    expect(customers.length).toBeGreaterThan(0);
    expect((await http.get('/customers?limit=5', tokenB).expect(200)).body.data).toEqual([]);
  });

  it("every route that takes an id refuses another workspace's record, for every method", async () => {
    const withIds = routes.filter((r) => r.path.includes(':') && !r.isPublic);
    const unmapped: string[] = [];
    const problems: string[] = [];
    let tried = 0;
    const before = await counts();
    for (const r of withIds) {
      const path = r.path.replace('/api/v1', '');
      if (NOT_AN_ID.some(([prefix]) => path.startsWith(prefix))) continue;
      const model = MODEL_OF_PREFIX.filter(([prefix]) => path.startsWith(prefix)).sort(
        (a, b) => b[0].length - a[0].length,
      )[0]?.[1];
      if (!model) {
        unmapped.push(`${r.method} ${r.path}`);
        continue;
      }
      const id = idsByModel.get(model)?.[0];
      if (!id) continue; // the demo business has none of these; the model-level test covers it
      // the first parameter is the record; any other (a report key, an action name) gets a plain word
      let first = true;
      const concrete = r.path.replace(/:\w+/g, () => (first ? ((first = false), id) : 'extract'));
      const res = await call(r, tokenB, concrete);
      tried += 1;
      const label = `${r.method} ${r.path} -> ${res.status}`;
      if (res.status < 400 || res.status >= 500)
        problems.push(`${label} (another workspace's record must be refused)`);
      if (r.method === 'GET' && res.status !== 404 && res.status !== 400)
        problems.push(`${label} (a read must be a 404)`);
      const found = leaks(res.text, id);
      if (found.length > 0) problems.push(`${label} leaked ${found[0]}`);
    }
    expect(unmapped).toEqual([]);
    expect(problems).toEqual([]);
    expect(tried).toBeGreaterThan(80);
    // and nothing in workspace A changed
    expect(await counts()).toEqual(before);
  }, 300_000);

  it("search never finds another workspace's customers, leads, products or conversations", async () => {
    const names = [
      (
        await t.db.prisma.customer.findFirstOrThrow({
          where: { workspaceId: workspaceA, isWalkIn: false },
        })
      ).fullName,
      (await t.db.prisma.lead.findFirstOrThrow({ where: { workspaceId: workspaceA } })).fullName,
      (await t.db.prisma.product.findFirstOrThrow({ where: { workspaceId: workspaceA } })).name,
      (await t.db.prisma.supplier.findFirstOrThrow({ where: { workspaceId: workspaceA } })).name,
    ];
    for (const name of names) {
      expect(
        (
          await http.get(`/search?q=${encodeURIComponent(name)}`, tokenA).expect(200)
        ).body.data.groups.flatMap((g: Json) => g.hits).length,
      ).toBeGreaterThan(0);
      const other = (await http.get(`/search?q=${encodeURIComponent(name)}`, tokenB).expect(200))
        .body.data.groups as Json[];
      expect(other.flatMap((g) => g.hits)).toEqual([]);
    }
  });

  it('cannot be tricked by naming the other workspace: ids in bodies and queries do not widen access', async () => {
    const customer = idsByModel.get('Customer')?.[0] as string;
    const product = idsByModel.get('Product')?.[0] as string;
    // a workspace id in the body or query string is ignored
    const make = await call({ method: 'POST', path: '/customers' }, tokenB, '/api/v1/customers', {
      fullName: 'Planted',
      phones: ['+923001119999'],
      workspaceId: workspaceA,
    });
    expect(make.status).toBe(400); // unknown property
    const created = await call(
      { method: 'POST', path: '/customers' },
      tokenB,
      '/api/v1/customers',
      { fullName: 'Planted', phones: ['+923001119999'] },
    );
    expect(created.status).toBe(201);
    expect(
      await t.db.prisma.customer.findUniqueOrThrow({ where: { id: created.body.data.id } }),
    ).toMatchObject({ workspaceId: workspaceB });
    const widened = await call(
      { method: 'GET', path: '/customers' },
      tokenB,
      `/api/v1/customers?workspaceId=${workspaceA}`,
    );
    if (widened.status === 200)
      expect(widened.body.data.map((c: Json) => c.id)).toEqual([created.body.data.id]);
    else expect(widened.status).toBe(400);
    // an order, quotation or payment of B cannot point at A's customer or product
    const order = await call({ method: 'POST', path: '/orders' }, tokenB, '/api/v1/orders', {
      customerId: customer,
      lines: [{ productId: product, quantity: '1' }],
    });
    expect([400, 404, 422]).toContain(order.status);
    expect(await t.db.prisma.order.count({ where: { workspaceId: workspaceB } })).toBe(0);
  });

  async function counts(): Promise<Record<string, number>> {
    const prisma = t.db.prisma as unknown as Record<string, { count(a: unknown): Promise<number> }>;
    const out: Record<string, number> = {};
    for (const model of TENANT_MODELS) {
      out[model] = await prisma[lower(model)]!.count({ where: { workspaceId: workspaceA } }).catch(
        () => -1,
      );
    }
    return out;
  }
});
