import fc from 'fast-check';
import request from 'supertest';
import Decimal from 'decimal.js';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { ReportRegistry } from '../src/modules/reporting/report.registry';
import { SettingsService } from '../src/modules/settings/settings.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { runDemoSeed } from '../src/seed/demo-seed';
import { DEMO_STEPS } from '../src/seed/steps';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { runWithWorkspace } from './helpers/context';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

const EVERYTHING = 'from=2000-01-01&to=2100-01-01';
const FINANCIAL_KEYS = [
  'total',
  'subtotal',
  'discounts',
  'tax',
  'net',
  'paid',
  'balance',
  'received',
  'refunded',
  'amount',
  'ordered',
  'estimatedValue',
  'avgCost',
  'stockValue',
  'unitCost',
  'base',
];

describe('Reports (real PostgreSQL)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let registry: ReportRegistry;
  let owner: string;
  let salesperson: string;
  let manager: string;
  let workspaceId: string;
  let zoneKeys = 0;

  const login = async (email: string, password = 'demo-password-1') =>
    (await http.post('/auth/login', { email, password }).expect(200)).body.data
      .accessToken as string;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
    registry = t.app.get(ReportRegistry);
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
    workspaceId = seeded.workspaceId;
    owner = await login('owner@demo.test');
    salesperson = await login('salesperson@demo.test');
    manager = await login('manager@demo.test');
  }, 180_000);
  afterAll(() => t.close());

  const run = async (token: string, key: string, query = EVERYTHING) =>
    (await http.get(`/reports/${key}?${query}`, token).expect(200)).body.data as Json;
  const drill = async (token: string, key: string, row?: string, query = EVERYTHING) =>
    (
      await http
        .get(
          `/reports/${key}/drilldown?${query}${row === undefined ? '' : `&row=${encodeURIComponent(row)}`}`,
          token,
        )
        .expect(200)
    ).body.data as Json;
  const sum = (rows: Json[], column: string) =>
    rows.reduce((acc, r) => acc.plus(new Decimal(String(r[column] ?? 0))), new Decimal(0));

  describe('the catalogue', () => {
    it('lists the sixteen R1 reports for someone who may see them all', async () => {
      const list = (await http.get('/reports', owner).expect(200)).body.data as Json[];
      expect(list.map((r) => r.key).sort()).toEqual(
        [
          'commission-statement',
          'customer-balances',
          'expenses',
          'lead-conversion',
          'lead-pipeline',
          'low-stock',
          'orders-by-status',
          'payment-methods',
          'purchases',
          'sales-by-category',
          'sales-by-date',
          'sales-by-product',
          'sales-by-salesperson',
          'sales-history',
          'stock-movements',
          'stock-on-hand',
        ].sort(),
      );
    });

    it('leaves out reports a person may not run (13.8, 19.8)', async () => {
      const list = (await http.get('/reports', salesperson).expect(200)).body.data as Json[];
      const keys = list.map((r) => r.key);
      expect(keys).not.toContain('sales-by-date');
      expect(keys).not.toContain('payment-methods');
      expect(keys).toEqual(
        expect.arrayContaining(['orders-by-status', 'lead-pipeline', 'stock-on-hand']),
      );
      for (const r of list) expect(r.columns.some((c: Json) => c.financial)).toBe(false);
    });
  });

  describe('63.2 every report total equals the sum of its drill-down rows (19.4, 53.5)', () => {
    it.each([
      'sales-by-date',
      'sales-by-product',
      'sales-by-category',
      'sales-by-salesperson',
      'sales-history',
      'orders-by-status',
      'lead-pipeline',
      'lead-conversion',
      'customer-balances',
      'payment-methods',
      'stock-on-hand',
      'low-stock',
      'stock-movements',
      'commission-statement',
      'expenses',
      'purchases',
    ])(
      '%s',
      async (key) => {
        const def = registry.get(key);
        expect(def).toBeDefined();
        const report = await run(owner, key);
        expect(report.truncated).toBe(false);
        for (const { column, drillColumn } of def?.reconciles ?? []) {
          // the report's own total is the sum of its rows
          expect(sum(report.rows, column).toString()).toBe(
            new Decimal(report.totals[column] ?? sum(report.rows, column)).toString(),
          );
          // each row is the sum of the records behind it
          for (const row of report.rows as Json[]) {
            const records = await drill(owner, key, row.key);
            expect([key, row.key, sum(records.rows, drillColumn).toString()]).toEqual([
              key,
              row.key,
              new Decimal(String(row[column])).toString(),
            ]);
          }
          // and the whole total is the sum of all records
          const all = await drill(owner, key);
          expect([key, column, sum(all.rows, drillColumn).toString()]).toEqual([
            key,
            column,
            sum(report.rows, column).toString(),
          ]);
        }
      },
      60_000,
    );

    it('the seeded dataset gives the main reports something to show', async () => {
      for (const key of [
        'sales-by-date',
        'sales-by-product',
        'sales-history',
        'orders-by-status',
        'lead-pipeline',
        'stock-on-hand',
        'stock-movements',
        'purchases',
        'expenses',
        'commission-statement',
        'payment-methods',
      ]) {
        expect([key, (await run(owner, key)).rows.length > 0]).toEqual([key, true]);
      }
    });

    it('reports on the source records: sales by date adds up to the orders it counts', async () => {
      const report = await run(owner, 'sales-by-date');
      const orders = await t.db.prisma.order.findMany({
        where: { workspaceId, NOT: { status: { in: ['draft', 'cancelled'] } } },
        select: { totalAmount: true },
      });
      expect(new Decimal(report.totals.total).toString()).toBe(
        orders.reduce((a, o) => a.plus(o.totalAmount.toFixed()), new Decimal(0)).toString(),
      );
      expect(report.totals.orders).toBe(String(orders.length));
    });
  });

  describe('63.1 Property 12 — financial visibility gate (13.8, 19.8)', () => {
    const keys = [
      'sales-by-date',
      'sales-by-product',
      'sales-by-category',
      'sales-by-salesperson',
      'sales-history',
      'orders-by-status',
      'lead-pipeline',
      'lead-conversion',
      'customer-balances',
      'payment-methods',
      'stock-on-hand',
      'low-stock',
      'stock-movements',
      'commission-statement',
      'expenses',
      'purchases',
    ];

    it('someone without report:financial gets no money figure from any report, filter or drill-down', async () => {
      const financial = new Set(
        registry
          .all()
          .filter((d) => d.financial)
          .map((d) => d.key),
      );
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...keys),
          fc.constantFrom('', 'range=today', 'range=week', 'range=month', EVERYTHING),
          fc.boolean(),
          async (key, query, drilling) => {
            const url = drilling
              ? `/reports/${key}/drilldown?${query}`
              : `/reports/${key}?${query}`;
            const res = await http.get(url, salesperson);
            if (financial.has(key)) {
              expect(res.status).toBe(403);
              return;
            }
            expect(res.status).toBe(200);
            const body = res.body.data as Json;
            expect(body.columns.some((c: Json) => c.financial || c.type === 'money')).toBe(false);
            for (const row of body.rows as Json[]) {
              for (const k of FINANCIAL_KEYS) expect([key, k, k in row]).toEqual([key, k, false]);
            }
            for (const k of FINANCIAL_KEYS)
              expect(body.totals ? k in body.totals : false).toBe(false);
          },
        ),
        { numRuns: 40 },
      );
    }, 120_000);

    it('the same reports show their money columns to someone with report:financial', async () => {
      const lead = await run(manager, 'lead-pipeline');
      expect(lead.columns.map((c: Json) => c.key)).toContain('estimatedValue');
      expect(lead.rows[0].estimatedValue).toBeDefined();
      const stock = await run(manager, 'stock-on-hand');
      expect(stock.totals.stockValue).toBeDefined();
    });
  });

  describe('permissions, scope and validation', () => {
    it('refuses an unknown report, bad dates and a missing token', async () => {
      await http.get('/reports/nope', owner).expect(404);
      await http.get('/reports/sales-by-date?from=yesterday', owner).expect(400);
      await http.get('/reports/sales-by-date?limit=999999', owner).expect(400);
      await http.get('/reports').expect(401);
    });

    it('needs the permissions of the data behind the report', async () => {
      // a Viewer has report:view only if the default role says so; either way they cannot run a money report
      const viewer = await login('viewer@demo.test');
      await http.get('/reports/sales-by-date', viewer).expect(403);
    });

    it('swaps the dates when they are the wrong way round, and covers both end days', async () => {
      const a = await run(owner, 'sales-by-date', 'from=2100-01-01&to=2000-01-01');
      expect(a.range).toEqual({ from: '2000-01-01', to: '2100-01-01' });
    });
  });

  describe('dates follow the workspace timezone (19.5, 44.4)', () => {
    it('an order placed late in the evening there belongs to the next UTC day, and a day filter finds it', async () => {
      const ws = await t.app.get(TenantsService).createWorkspace({
        name: 'Zone Co',
        industryProfile: 'furniture',
        owner: {
          email: 'owner@zone.test',
          firstName: 'Z',
          lastName: 'Z',
          password: 'owner-password-1',
        },
        country: 'PK',
      });
      await runWithWorkspace(t.app, ws.workspaceId, () =>
        t.app.get(SettingsService).update({ locale: { timezone: 'Asia/Karachi' } }),
      );
      const token = await login('owner@zone.test', 'owner-password-1');
      const customer = (
        await http
          .post('/customers', { fullName: 'Zed', phones: ['0300-9990001'] }, token)
          .expect(201)
      ).body.data;
      const product = (
        await http
          .post(
            '/catalog/products',
            {
              type: 'NON_STOCKABLE',
              code: 'Z',
              name: 'Z',
              basePrice: '100',
              variants: [{ sku: 'Z-1' }],
            },
            token,
          )
          .expect(201)
      ).body.data;
      const made = async (iso: string) => {
        const o = (
          await request(t.app.getHttpServer())
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${token}`)
            .set('Idempotency-Key', `zone-${++zoneKeys}`)
            .send({
              customerId: customer.id,
              lines: [{ variantId: product.variants[0].id, quantity: '1' }],
            })
            .expect(201)
        ).body.data;
        await t.db.prisma.order.update({
          where: { id: o.id },
          data: { status: 'confirmed', orderDate: new Date(iso) },
        });
      };
      // 2026-03-10 20:30 UTC is 01:30 on the 11th in Karachi; 2026-03-10 18:30 UTC is 23:30 on the 10th
      await made('2026-03-10T20:30:00Z');
      await made('2026-03-10T18:30:00Z');
      const days = (await run(token, 'sales-by-date', 'from=2026-03-09&to=2026-03-12')).rows.map(
        (r: Json) => [r.date, r.orders],
      );
      expect(days).toEqual([
        ['2026-03-10', 1],
        ['2026-03-11', 1],
      ]);
      const only11 = await run(token, 'sales-by-date', 'from=2026-03-11&to=2026-03-11');
      expect(only11.totals.orders).toBe('1');
    });
  });

  describe('tenant isolation', () => {
    it("another workspace's reports hold none of this workspace's data", async () => {
      await t.app.get(TenantsService).createWorkspace({
        name: 'Other Co',
        industryProfile: 'furniture',
        owner: {
          email: 'owner@other.test',
          firstName: 'O',
          lastName: 'O',
          password: 'owner-password-1',
        },
        country: 'PK',
      });
      const token = await login('owner@other.test', 'owner-password-1');
      for (const key of registry.all().map((d) => d.key)) {
        const report = await run(token, key);
        expect([
          key,
          report.rows.filter((r: Json) =>
            Object.values(r).some((v) => typeof v === 'string' && v.includes(workspaceId)),
          ),
        ]).toEqual([key, []]);
      }
      expect((await run(token, 'sales-by-date')).rows).toEqual([]);
      expect((await run(token, 'stock-on-hand')).rows).toEqual([]);
    });
  });
});
