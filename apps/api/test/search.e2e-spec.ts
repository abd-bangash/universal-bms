import type { INestApplication } from '@nestjs/common';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Global search (real PostgreSQL)', () => {
  let t: TestApp;
  let app: INestApplication;
  let http: ReturnType<typeof api>;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp();
    app = t.app;
    http = api(app);
  }, 90_000);
  afterAll(() => t.close());

  async function business() {
    const email = `owner${++n}@search.test`;
    const created = await app.get(TenantsService).createWorkspace({
      name: `Search ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'Olivia', lastName: 'Owner', password: 'owner-password-1' },
      country: 'PK',
    });
    const login = await http
      .post('/auth/login', { email, password: 'owner-password-1' })
      .expect(200);
    const token = login.body.data.accessToken as string;
    const roles = (await http.get('/roles', token).expect(200)).body.data as Json[];
    return { ...created, token, roles };
  }
  type Biz = Awaited<ReturnType<typeof business>>;

  async function member(b: Biz, roleName: string) {
    const email = `${roleName.toLowerCase().replace(/\W/g, '')}${++n}@search.test`;
    const role = b.roles.find((r) => r.name === roleName) as Json;
    const invite = await http
      .post('/users/invite', { email, roleIds: [role.id] }, b.token)
      .expect(201);
    await http
      .post('/auth/invite/accept', {
        token: invite.body.data.token,
        password: 'member-password-1',
        firstName: roleName,
        lastName: 'Person',
      })
      .expect(200);
    const login = await http
      .post('/auth/login', { email, password: 'member-password-1' })
      .expect(200);
    return { token: login.body.data.accessToken as string };
  }

  const search = async (token: string, q: string) =>
    (await http.get(`/search?q=${encodeURIComponent(q)}`, token).expect(200)).body.data
      .groups as Json[];
  const titles = (groups: Json[], type: string) =>
    (groups.find((g) => g.type === type)?.hits ?? []).map((h: Json) => h.title);

  async function seed(b: Biz) {
    await http
      .post(
        '/customers',
        { fullName: 'Ayesha Khan', phones: ['0300-1234567'], email: 'ayesha@example.com' },
        b.token,
      )
      .expect(201);
    await http
      .post('/customers', { fullName: 'Bilal Sofa-Lover', phones: ['0321-7654321'] }, b.token)
      .expect(201);
    await http
      .post(
        '/leads',
        { fullName: 'Sana Malik', phone: '0333-5550000', interest: 'Corner sofa in grey' },
        b.token,
      )
      .expect(201);
    await http
      .post(
        '/catalog/products',
        {
          code: 'SOFA-1',
          name: 'Milano Corner Sofa',
          basePrice: '145000',
          aliases: ['couch'],
          variants: [{ sku: 'MILANO-GREY', barcode: '8960001' }],
        },
        b.token,
      )
      .expect(201);
  }

  describe('groups and matching (31.1, 31.2, 31.4)', () => {
    it('finds customers, leads and products by name, partial and case-insensitive, grouped by type', async () => {
      const b = await business();
      await seed(b);
      const groups = await search(b.token, 'SOFA');
      expect(groups.map((g) => g.type)).toEqual(
        expect.arrayContaining(['CUSTOMER', 'LEAD', 'PRODUCT']),
      );
      expect(titles(groups, 'CUSTOMER')).toEqual(['Bilal Sofa-Lover']);
      expect(titles(groups, 'LEAD')).toEqual(['Sana Malik']); // by interest
      expect(titles(groups, 'PRODUCT')).toEqual(['Milano Corner Sofa']);
      const hit = (groups.find((g) => g.type === 'PRODUCT') as Json).hits[0];
      expect(hit).toMatchObject({
        type: 'PRODUCT',
        href: `/products/${hit.id}`,
        subtitle: 'SOFA-1',
      });
      expect((groups.find((g) => g.type === 'CUSTOMER') as Json).hits[0].href).toMatch(
        /^\/customers\//,
      );
    });

    it('matches a phone however it is written', async () => {
      const b = await business();
      await seed(b);
      for (const written of [
        '0300-1234567',
        '+92 300 1234567',
        '923001234567',
        '300 123',
        '(0300) 1234567',
        '1234567',
      ]) {
        const groups = await search(b.token, written);
        expect({ written, found: titles(groups, 'CUSTOMER') }).toEqual({
          written,
          found: ['Ayesha Khan'],
        });
      }
      expect(titles(await search(b.token, '0333 555'), 'LEAD')).toEqual(['Sana Malik']);
      expect(await search(b.token, '0300-9999999')).toEqual([]);
    });

    it('matches email, product code, SKU, barcode and alias', async () => {
      const b = await business();
      await seed(b);
      expect(titles(await search(b.token, 'ayesha@example'), 'CUSTOMER')).toEqual(['Ayesha Khan']);
      for (const q of ['sofa-1', 'milano-grey', '896000', 'couch']) {
        expect({ q, found: titles(await search(b.token, q), 'PRODUCT') }).toEqual({
          q,
          found: ['Milano Corner Sofa'],
        });
      }
      expect(
        (await search(b.token, 'milano-grey')).find((g) => g.type === 'PRODUCT')?.hits[0].subtitle,
      ).toBe('SOFA-1 · MILANO-GREY');
    });

    it('returns at most 5 per type, best (exact) match first, and nothing for a short or empty query', async () => {
      const b = await business();
      for (let i = 1; i <= 8; i++) {
        await http
          .post('/customers', { fullName: `Zed Person ${i}`, phones: [`0300-55500${i}0`] }, b.token)
          .expect(201);
      }
      await http
        .post('/customers', { fullName: 'zed', phones: ['0300-5559999'] }, b.token)
        .expect(201);
      const groups = await search(b.token, 'zed');
      expect(groups).toHaveLength(1);
      expect(groups[0]?.hits).toHaveLength(5);
      expect(groups[0]?.hits[0].title).toBe('zed');
      expect(await search(b.token, 'z')).toEqual([]);
      expect(await search(b.token, '   ')).toEqual([]);
      await http.get('/search', b.token).expect(400);
    });

    it('treats LIKE wildcards as plain text and never as SQL', async () => {
      const b = await business();
      await seed(b);
      expect(await search(b.token, '%%')).toEqual([]);
      expect(await search(b.token, '___')).toEqual([]);
      expect(await search(b.token, "x'; DROP TABLE customers; --")).toEqual([]);
      expect(titles(await search(b.token, 'ayesha'), 'CUSTOMER')).toEqual(['Ayesha Khan']);
    });

    it('does not offer the walk-in customer, archived customers or archived products', async () => {
      const b = await business();
      await seed(b);
      expect(await search(b.token, 'walk-in')).toEqual([]);
      const customers = (await http.get('/customers?q=ayesha', b.token)).body.data as Json[];
      await http.post(`/customers/${customers[0]?.id}/archive`, {}, b.token).expect(200);
      expect(titles(await search(b.token, 'ayesha'), 'CUSTOMER')).toEqual([]);
      const product = (await http.get('/catalog/products?q=milano', b.token)).body.data[0] as Json;
      await http.post(`/catalog/products/${product.id}/archive`, {}, b.token).expect(200);
      expect(titles(await search(b.token, 'milano'), 'PRODUCT')).toEqual([]);
    });
  });

  describe('permissions and isolation (31.3) — integration test 29.1', () => {
    it("never includes another workspace's records", async () => {
      const a = await business();
      const other = await business();
      await seed(a);
      for (const q of [
        'ayesha',
        'sofa',
        'milano',
        '0300-1234567',
        'couch',
        'MILANO-GREY',
        'sana',
      ]) {
        expect({ q, groups: await search(other.token, q) }).toEqual({ q, groups: [] });
      }
      // and its own search still works
      await http
        .post('/customers', { fullName: 'Ayesha Other', phones: ['0300-1234567'] }, other.token)
        .expect(201);
      expect(titles(await search(other.token, 'ayesha'), 'CUSTOMER')).toEqual(['Ayesha Other']);
      expect(titles(await search(a.token, 'ayesha'), 'CUSTOMER')).toEqual(['Ayesha Khan']);
    });

    it('returns only the entity types the user may view', async () => {
      const b = await business();
      await seed(b);
      const production = await member(b, 'Production Staff'); // views production and products, not customers or leads
      const viewer = await member(b, 'Viewer');
      const sofa = async (token: string) => (await search(token, 'sofa')).map((g) => g.type).sort();
      expect(await sofa(b.token)).toEqual(['CUSTOMER', 'LEAD', 'PRODUCT']);
      expect(await sofa(viewer.token)).toEqual(['CUSTOMER', 'PRODUCT']); // leads: only their own, and they have none
      const prodTypes = await sofa(production.token);
      expect(prodTypes).not.toContain('CUSTOMER');
      expect(prodTypes).not.toContain('LEAD');
    });

    it('shows a salesperson only the leads that are theirs (like the leads list)', async () => {
      const b = await business();
      const sales = await member(b, 'Salesperson');
      await http
        .post('/leads', { fullName: 'Owner Lead Olga', phone: '0300-1110001' }, b.token)
        .expect(201);
      await http
        .post('/leads', { fullName: 'Own Lead Omar', phone: '0300-1110002' }, sales.token)
        .expect(201);
      expect(titles(await search(sales.token, 'lead'), 'LEAD')).toEqual(['Own Lead Omar']);
      expect(titles(await search(b.token, 'lead'), 'LEAD').sort()).toEqual([
        'Own Lead Omar',
        'Owner Lead Olga',
      ]);
    });

    it('does not return cost information for products', async () => {
      const b = await business();
      await http
        .post(
          '/catalog/products',
          { code: 'P-COST', name: 'Costly Chair', basePrice: '100', costPrice: '60' },
          b.token,
        )
        .expect(201);
      expect(JSON.stringify(await search(b.token, 'costly'))).not.toMatch(/cost_?price|"60"/i);
    });

    it('requires a signed-in user', async () => {
      await http.get('/search?q=anything').expect(401);
    });
  });

  describe('speed (31.5)', () => {
    it('answers in well under 500 ms with 100,000 customers in the workspace', async () => {
      const b = await business();
      await t.db.prisma.$executeRawUnsafe(`
        INSERT INTO customers (id, workspace_id, full_name, phones, phones_normalized, email, status, is_walk_in, updated_at)
        SELECT 'perf_' || g, '${b.workspaceId}', 'Customer ' || g || ' Perf', ARRAY['0300' || lpad(g::text, 7, '0')],
               ARRAY['+92300' || lpad(g::text, 7, '0')], 'perf' || g || '@bulk.test', 'ACTIVE', false, now()
        FROM generate_series(1, 100000) g`);
      await t.db.prisma.$executeRawUnsafe(`
        INSERT INTO leads (id, workspace_id, full_name, phone, phone_normalized, interest, stage, priority, updated_at)
        SELECT 'perfl_' || g, '${b.workspaceId}', 'Lead ' || g || ' Perf', '0301' || lpad(g::text, 7, '0'),
               '+92301' || lpad(g::text, 7, '0'), 'sofa number ' || g, 'new', 'MEDIUM', now()
        FROM generate_series(1, 20000) g`);
      await t.db.prisma.$executeRawUnsafe('ANALYZE customers');
      await t.db.prisma.$executeRawUnsafe('ANALYZE leads');

      const queries = [
        'customer 5000',
        'perf',
        'perf77@bulk',
        '0300000123',
        'sofa number 1999',
        'lead 777',
        'nothing like this',
        '300000',
      ];
      await search(b.token, 'warm up');
      const times: number[] = [];
      for (const q of queries) {
        const start = process.hrtime.bigint();
        const groups = await search(b.token, q);
        times.push(Number(process.hrtime.bigint() - start) / 1e6);
        expect(groups.every((g) => g.hits.length <= 5)).toBe(true);
      }
      const sorted = [...times].sort((x, y) => x - y);
      const p95 = sorted[
        Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
      ] as number;
      expect(p95).toBeLessThan(500);
    }, 120_000);
  });
});
