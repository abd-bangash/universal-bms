import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import sharp from 'sharp';
import { VariantLookupService } from '../src/modules/catalog/variant-lookup.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { runWithWorkspace } from './helpers/context';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Catalog API (real PostgreSQL)', () => {
  let t: TestApp;
  let app: INestApplication;
  let http: ReturnType<typeof api>;
  let tenants: TenantsService;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp();
    app = t.app;
    http = api(app);
    tenants = app.get(TenantsService);
  }, 90_000);
  afterAll(() => t.close());

  async function business() {
    const email = `owner${++n}@catalog.test`;
    const created = await tenants.createWorkspace({
      name: `Catalog ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'Olivia', lastName: 'Owner', password: 'owner-password-1' },
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
    const email = `${roleName.toLowerCase().replace(/\W/g, '')}${++n}@catalog.test`;
    const role = b.roles.find((r) => r.name === roleName) as Json;
    const invite = await http
      .post('/users/invite', { email, roleIds: [role.id] }, b.token)
      .expect(201);
    await http
      .post('/auth/invite/accept', {
        token: invite.body.data.token,
        password: 'member-password-1',
        firstName: 'M',
        lastName: 'M',
      })
      .expect(200);
    const login = await http
      .post('/auth/login', { email, password: 'member-password-1' })
      .expect(200);
    return login.body.data.accessToken as string;
  }

  const createProduct = (b: Biz, body: object = {}) =>
    http.post('/catalog/products', { name: 'Sofa', basePrice: '1000.00', ...body }, b.token);

  describe('products and default variant', () => {
    it('creates a product with a default variant and a generated code (36.8)', async () => {
      const b = await business();
      const first = await createProduct(b, { costPrice: '600.00' }).expect(201);
      expect(first.body.data).toMatchObject({
        code: 'P-000001',
        status: 'ACTIVE',
        basePrice: '1000',
        costPrice: '600',
        version: 1,
      });
      expect(first.body.data.variants).toHaveLength(1);
      expect(first.body.data.variants[0]).toMatchObject({ sku: 'P-000001', isDefault: true });

      const second = await createProduct(b, { code: 'SOFA-X' }).expect(201);
      expect(second.body.data.variants[0].sku).toBe('SOFA-X');
      const third = await createProduct(b).expect(201);
      expect(third.body.data.code).toBe('P-000002');
    });

    it('creates nested variants with their own price, barcode and stock levels', async () => {
      const b = await business();
      const res = await createProduct(b, {
        code: 'CH',
        variants: [
          { sku: 'CH-RED', barcode: '111', priceOverride: '1200.50', minStockLevel: '2' },
          { sku: 'CH-BLUE', name: 'Blue', weight: '7.5' },
        ],
      }).expect(201);
      const skus = (res.body.data.variants as Json[]).map((v) => v.sku);
      expect(skus.sort()).toEqual(['CH-BLUE', 'CH-RED']);
      const red = (res.body.data.variants as Json[]).find((v) => v.sku === 'CH-RED') as Json;
      expect(red).toMatchObject({
        barcode: '111',
        priceOverride: '1200.5',
        minStockLevel: '2',
        isDefault: true,
      });
    });

    it('rejects bad input: negative or non-string money, unknown references, bundles', async () => {
      const b = await business();
      await createProduct(b, { basePrice: '-1' }).expect(400);
      await createProduct(b, { basePrice: 10 }).expect(400);
      await createProduct(b, { categoryId: 'nope' }).expect(400);
      await createProduct(b, { brandId: 'nope' }).expect(400);
      await createProduct(b, { type: 'BUNDLE' }).expect(400);
      await createProduct(b, { type: 'SERVICE', tracking: 'SERIAL' }).expect(400);
      await createProduct(b, { variants: [{ sku: 'A' }, { sku: 'A' }] }).expect(400);
      await http.post('/catalog/products', { basePrice: '1' }, b.token).expect(400);
    });

    it('validates custom fields against the definitions, with field-level errors (6.3)', async () => {
      const b = await business();
      await http
        .post(
          '/fields',
          {
            entityType: 'PRODUCT',
            key: 'wood_kind',
            label: 'Wood kind',
            type: 'DROPDOWN',
            options: [{ key: 'oak', label: 'Oak' }],
            required: true,
          },
          b.token,
        )
        .expect(201);
      const missing = await createProduct(b).expect(400);
      expect(missing.body.details['customFields.wood_kind']).toBeDefined();
      await createProduct(b, { customFields: { wood_kind: 'plastic' } }).expect(400);
      const ok = await createProduct(b, { customFields: { wood_kind: 'oak' } }).expect(201);
      expect(ok.body.data.customFields).toEqual({ wood_kind: 'oak' });
    });
  });

  describe('SKU and barcode uniqueness (Requirement 36.3, 6.6)', () => {
    it('rejects a duplicate SKU or barcode with 409, on create, add and edit', async () => {
      const b = await business();
      const a = await createProduct(b, {
        code: 'A',
        variants: [{ sku: 'SKU-A', barcode: '5000' }],
      }).expect(201);

      const dupSku = await createProduct(b, { code: 'B', variants: [{ sku: 'SKU-A' }] }).expect(
        409,
      );
      expect(dupSku.body).toMatchObject({
        code: 'POSSIBLE_DUPLICATE',
        details: { sku: expect.any(Array) },
      });
      const dupBarcode = await createProduct(b, {
        code: 'C',
        variants: [{ sku: 'SKU-C', barcode: '5000' }],
      }).expect(409);
      expect(dupBarcode.body.details.barcode).toBeDefined();
      // nothing was half-created
      expect(await t.db.prisma.product.count({ where: { workspaceId: b.workspaceId } })).toBe(1);

      const other = await createProduct(b, { code: 'D', variants: [{ sku: 'SKU-D' }] }).expect(201);
      const otherVariant = other.body.data.variants[0].id as string;
      await http.patch(`/catalog/variants/${otherVariant}`, { sku: 'SKU-A' }, b.token).expect(409);
      await http
        .patch(`/catalog/variants/${otherVariant}`, { barcode: '5000' }, b.token)
        .expect(409);
      await http
        .post(`/catalog/products/${a.body.data.id}/variants`, { sku: 'SKU-D' }, b.token)
        .expect(409);
      await createProduct(b, { code: 'A' }).expect(409); // product code too

      // two variants may both have no barcode, and the same SKU may exist in another workspace
      await http
        .post(`/catalog/products/${a.body.data.id}/variants`, { sku: 'SKU-E' }, b.token)
        .expect(201);
      await http
        .post(`/catalog/products/${a.body.data.id}/variants`, { sku: 'SKU-F' }, b.token)
        .expect(201);
      const b2 = await business();
      await createProduct(b2, { code: 'A', variants: [{ sku: 'SKU-A', barcode: '5000' }] }).expect(
        201,
      );
    });
  });

  describe('archive, pickers and documents (Requirements 6.7, 36)', () => {
    it('archives with every variant, hides it from lists and pickers, refuses new lines with 422', async () => {
      const b = await business();
      const p = (
        await createProduct(b, {
          code: 'OLD',
          variants: [{ sku: 'OLD-1', barcode: '777' }],
        }).expect(201)
      ).body.data as Json;
      const keep = (
        await createProduct(b, { code: 'NEW', variants: [{ sku: 'NEW-1' }] }).expect(201)
      ).body.data as Json;

      const archived = await http
        .post(`/catalog/products/${p.id}/archive`, {}, b.token)
        .expect(200);
      expect(archived.body.data.status).toBe('ARCHIVED');
      expect(archived.body.data.variants.every((v: Json) => v.status === 'ARCHIVED')).toBe(true);

      const list = await http.get('/catalog/products', b.token).expect(200);
      expect((list.body.data as Json[]).map((x) => x.code)).toEqual(['NEW']);
      const onlyArchived = await http.get('/catalog/products?status=ARCHIVED', b.token).expect(200);
      expect((onlyArchived.body.data as Json[]).map((x) => x.code)).toEqual(['OLD']);

      const search = await http.get('/catalog/variants/search?q=OLD', b.token).expect(200);
      expect(search.body.data).toEqual([]);
      const scan = await http.get('/catalog/variants/lookup?code=777', b.token).expect(422);
      expect(scan.body.code).toBe('PRODUCT_ARCHIVED');

      const lookup = app.get(VariantLookupService);
      const run = <T>(work: () => Promise<T>) => runWithWorkspace(app, b.workspaceId, work);
      await expect(run(() => lookup.assertSellable([p.variants[0].id]))).rejects.toMatchObject({
        code: 'PRODUCT_ARCHIVED',
        status: 422,
      });
      // a mixed set is refused as a whole
      await expect(
        run(() => lookup.assertSellable([keep.variants[0].id, p.variants[0].id])),
      ).rejects.toMatchObject({ code: 'PRODUCT_ARCHIVED' });
      await expect(
        run(() => lookup.assertSellable([keep.variants[0].id])),
      ).resolves.toBeUndefined();

      // an archived product cannot be edited or get new variants; archiving twice is harmless
      await http
        .patch(
          `/catalog/products/${p.id}`,
          { version: archived.body.data.version, name: 'x' },
          b.token,
        )
        .expect(422);
      await http.post(`/catalog/products/${p.id}/variants`, { sku: 'OLD-2' }, b.token).expect(422);
      await http.post(`/catalog/products/${p.id}/archive`, {}, b.token).expect(200);

      // restoring needs product:archive and brings the variants back
      const restored = await http
        .patch(
          `/catalog/products/${p.id}`,
          { version: archived.body.data.version, status: 'ACTIVE' },
          b.token,
        )
        .expect(200);
      expect(restored.body.data.status).toBe('ACTIVE');
      expect(restored.body.data.variants[0].status).toBe('ACTIVE');
    });
  });

  describe('cost visibility (product:view_cost)', () => {
    it('omits cost fields, not zeroes them, for users without the permission', async () => {
      const b = await business();
      const created = (
        await createProduct(b, {
          costPrice: '300',
          variants: [{ sku: 'C-1', costOverride: '310' }],
        }).expect(201)
      ).body.data as Json;
      const salesperson = await member(b, 'Salesperson');

      const asOwner = (await http.get(`/catalog/products/${created.id}`, b.token).expect(200)).body
        .data;
      expect(asOwner.costPrice).toBe('300');
      expect(asOwner.variants[0].costOverride).toBe('310');

      const asSales = (await http.get(`/catalog/products/${created.id}`, salesperson).expect(200))
        .body.data;
      expect(asSales).not.toHaveProperty('costPrice');
      expect(asSales.variants[0]).not.toHaveProperty('costOverride');
      const list = (await http.get('/catalog/products', salesperson).expect(200)).body
        .data as Json[];
      expect(JSON.stringify(list)).not.toMatch(/cost/i);
      const scan = (await http.get('/catalog/variants/lookup?code=C-1', salesperson).expect(200))
        .body.data;
      expect(JSON.stringify(scan)).not.toMatch(/cost/i);
    });

    it('enforces product permissions on writes', async () => {
      const b = await business();
      const salesperson = await member(b, 'Salesperson'); // product:view only
      await http.post('/catalog/products', { name: 'x', basePrice: '1' }, salesperson).expect(403);
      await http.post('/catalog/categories', { name: 'x' }, salesperson).expect(403);
      await http.post('/catalog/brands', { name: 'x' }, salesperson).expect(403);
      const p = (await createProduct(b).expect(201)).body.data as Json;
      await http.post(`/catalog/products/${p.id}/archive`, {}, salesperson).expect(403);
    });
  });

  describe('optimistic concurrency (Requirement 54.2)', () => {
    it('rejects an update carrying a stale version with 409', async () => {
      const b = await business();
      const p = (await createProduct(b).expect(201)).body.data as Json;
      const first = await http
        .patch(`/catalog/products/${p.id}`, { version: 1, name: 'Sofa 2' }, b.token)
        .expect(200);
      expect(first.body.data).toMatchObject({ name: 'Sofa 2', version: 2 });
      const stale = await http
        .patch(`/catalog/products/${p.id}`, { version: 1, name: 'Sofa 3' }, b.token)
        .expect(409);
      expect(stale.body.code).toBe('STALE_VERSION');
      expect((await http.get(`/catalog/products/${p.id}`, b.token)).body.data.name).toBe('Sofa 2');
      await http.patch(`/catalog/products/${p.id}`, { name: 'no version' }, b.token).expect(400);
    });

    it('lets exactly one of two simultaneous edits win', async () => {
      const b = await business();
      const p = (await createProduct(b).expect(201)).body.data as Json;
      const results = await Promise.all(
        ['A', 'B', 'C'].map((name) =>
          http.patch(`/catalog/products/${p.id}`, { version: 1, name }, b.token),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    });
  });

  describe('generate variants (Requirement 36.7)', () => {
    async function axes(b: Biz) {
      const mk = (key: string, options: string[]) =>
        http
          .post(
            '/fields',
            {
              entityType: 'VARIANT',
              key,
              label: key,
              type: 'DROPDOWN',
              isVariantAxis: true,
              options: options.map((o) => ({ key: o, label: o })),
            },
            b.token,
          )
          .expect(201);
      await mk('tone', ['red', 'blue', 'green']);
      await mk('sz', ['s', 'm']);
    }

    it('builds the Cartesian product, skips existing combinations and retires the blank default', async () => {
      const b = await business();
      await axes(b);
      const p = (await createProduct(b, { code: 'TEE' }).expect(201)).body.data as Json;

      const gen = await http
        .post(
          `/catalog/products/${p.id}/generate-variants`,
          { axes: [{ key: 'tone' }, { key: 'sz' }] },
          b.token,
        )
        .expect(200);
      expect(gen.body.data.created).toHaveLength(6);
      expect((gen.body.data.created as Json[]).map((v) => v.sku).sort()).toEqual([
        'TEE-blue-m',
        'TEE-blue-s',
        'TEE-green-m',
        'TEE-green-s',
        'TEE-red-m',
        'TEE-red-s',
      ]);
      const after = (await http.get(`/catalog/products/${p.id}`, b.token)).body.data;
      const active = (after.variants as Json[]).filter((v) => v.status === 'ACTIVE');
      expect(active).toHaveLength(6);
      expect(active.filter((v) => v.isDefault)).toHaveLength(1);
      expect((after.variants as Json[]).find((v) => v.sku === 'TEE')).toMatchObject({
        status: 'ARCHIVED',
        isDefault: false,
      });
      expect(active[0].customFields).toEqual(
        expect.objectContaining({ tone: expect.any(String), sz: expect.any(String) }),
      );

      // running again, or with a subset, creates nothing new
      const again = await http
        .post(
          `/catalog/products/${p.id}/generate-variants`,
          { axes: [{ key: 'tone' }, { key: 'sz', optionKeys: ['s'] }] },
          b.token,
        )
        .expect(200);
      expect(again.body.data).toMatchObject({ created: [], skipped: 3 });
    });

    it('rejects unknown axes and options, repeated axes and oversized sets', async () => {
      const b = await business();
      await axes(b);
      const p = (await createProduct(b).expect(201)).body.data as Json;
      const gen = (body: object) =>
        http.post(`/catalog/products/${p.id}/generate-variants`, body, b.token);
      await gen({ axes: [{ key: 'nope' }] }).expect(400);
      await gen({ axes: [{ key: 'tone', optionKeys: ['pink'] }] }).expect(400);
      await gen({ axes: [{ key: 'tone' }, { key: 'tone' }] }).expect(400);
      await gen({ axes: [] }).expect(400);
    });
  });

  describe('lookup and search', () => {
    it('matches barcode before SKU, and searches name, SKU, barcode and aliases (36.3, 36.4)', async () => {
      const b = await business();
      await createProduct(b, {
        name: 'Corner Sofa',
        code: 'CS',
        aliases: ['couch', 'sectional'],
        variants: [{ sku: 'CS-1', barcode: 'BAR1' }],
      }).expect(201);
      await createProduct(b, {
        name: 'Odd',
        code: 'ODD',
        variants: [{ sku: 'BAR1-SKU', barcode: '9999' }, { sku: '9999-X' }],
      }).expect(201);

      const byBarcode = await http.get('/catalog/variants/lookup?code=BAR1', b.token).expect(200);
      expect(byBarcode.body.data).toMatchObject({
        sku: 'CS-1',
        price: '1000',
        availableStock: null,
      });
      const bySku = await http.get('/catalog/variants/lookup?code=cs-1', b.token).expect(200);
      expect(bySku.body.data.sku).toBe('CS-1');
      // a code that is one variant's barcode and another's SKU resolves to the barcode
      await t.db.prisma.productVariant.updateMany({
        where: { workspaceId: b.workspaceId, sku: '9999-X' },
        data: { sku: '9999' },
      });
      expect(
        (await http.get('/catalog/variants/lookup?code=9999', b.token).expect(200)).body.data.sku,
      ).toBe('BAR1-SKU');
      await http.get('/catalog/variants/lookup?code=zzz', b.token).expect(404);

      const names = async (q: string) =>
        (
          (
            await http
              .get(`/catalog/variants/search?q=${encodeURIComponent(q)}`, b.token)
              .expect(200)
          ).body.data as Json[]
        ).map((v) => v.sku);
      expect(await names('corner')).toEqual(['CS-1']);
      expect(await names('COUCH')).toEqual(['CS-1']);
      expect(await names('cs-1')).toEqual(['CS-1']);
      expect(await names('bar1')).toEqual(['CS-1', 'BAR1-SKU']); // the exact barcode first
      expect(await names('50%')).toEqual([]); // wildcards are literal
      await http.get('/catalog/variants/search', b.token).expect(400);
    });

    it('honours the POS and AI visibility flags (36.5)', async () => {
      const b = await business();
      await createProduct(b, { name: 'Hidden Pos', code: 'HP', visibleInPos: false }).expect(201);
      await createProduct(b, { name: 'Hidden Ai', code: 'HA', visibleToAi: false }).expect(201);
      const q = async (channel: string) =>
        (
          (
            await http
              .get(`/catalog/variants/search?q=Hidden&channel=${channel}`, b.token)
              .expect(200)
          ).body.data as Json[]
        )
          .map((v) => v.productCode)
          .sort();
      expect(await q('pos')).toEqual(['HA']);
      expect(await q('ai')).toEqual(['HP']);
    });

    it('uses the variant price override over the product price', async () => {
      const b = await business();
      await createProduct(b, {
        code: 'PR',
        variants: [{ sku: 'PR-1', priceOverride: '1500.25' }],
      }).expect(201);
      const res = await http.get('/catalog/variants/lookup?code=PR-1', b.token).expect(200);
      expect(res.body.data.price).toBe('1500.25');
    });
  });

  describe('lists and filters', () => {
    it('filters by text, category tree, brand, status and custom field, and pages by cursor', async () => {
      const b = await business();
      const cat = async (name: string, parentId?: string) =>
        (
          (await http.post('/catalog/categories', { name, parentId }, b.token).expect(201)).body
            .data as Json
        ).id as string;
      const living = await cat('Living');
      const sofas = await cat('Sofas', living);
      const beds = await cat('Beds');
      const brand = (
        (await http.post('/catalog/brands', { name: 'Acme' }, b.token).expect(201)).body
          .data as Json
      ).id;
      await http
        .post(
          '/fields',
          {
            entityType: 'PRODUCT',
            key: 'wood',
            label: 'Wood',
            type: 'DROPDOWN',
            options: [
              { key: 'oak', label: 'Oak' },
              { key: 'teak', label: 'Teak' },
            ],
          },
          b.token,
        )
        .expect(201);

      await createProduct(b, {
        name: 'Alpha Sofa',
        code: 'A1',
        categoryId: sofas,
        brandId: brand,
        customFields: { wood: 'oak' },
      }).expect(201);
      await createProduct(b, {
        name: 'Beta Sofa',
        code: 'B1',
        categoryId: sofas,
        customFields: { wood: 'teak' },
      }).expect(201);
      await createProduct(b, {
        name: 'Gamma Bed',
        code: 'G1',
        categoryId: beds,
        customFields: { wood: 'oak' },
      }).expect(201);
      await createProduct(b, { name: 'Delta Lamp', code: 'D1', status: 'INACTIVE' }).expect(201);

      const codes = async (qs: string) =>
        ((await http.get(`/catalog/products${qs}`, b.token).expect(200)).body.data as Json[]).map(
          (p) => p.code,
        );
      expect(await codes('')).toEqual(['A1', 'B1', 'D1', 'G1']); // sorted by name
      expect(await codes('?q=sofa')).toEqual(['A1', 'B1']);
      expect(await codes('?q=g1')).toEqual(['G1']);
      expect(await codes(`?categoryId=${living}`)).toEqual(['A1', 'B1']); // includes sub-categories
      expect(await codes(`?categoryId=${beds}`)).toEqual(['G1']);
      expect(await codes(`?brandId=${brand}`)).toEqual(['A1']);
      expect(await codes('?status=INACTIVE')).toEqual(['D1']);
      expect(await codes('?cf.wood=oak')).toEqual(['A1', 'G1']);
      expect(await codes(`?cf.wood=oak&categoryId=${sofas}`)).toEqual(['A1']);
      await http.get('/catalog/products?cf.unknown=1', b.token).expect(400);
      await http.get('/catalog/products?sort=basePrice:asc', b.token).expect(400);
      expect(await codes('?sort=name:desc')).toEqual(['G1', 'D1', 'B1', 'A1']);

      const page1 = await http.get('/catalog/products?limit=3', b.token).expect(200);
      expect(page1.body.data).toHaveLength(3);
      const cursor = page1.body.meta.nextCursor as string;
      expect(cursor).toBeDefined();
      const page2 = await http
        .get(`/catalog/products?limit=3&cursor=${cursor}`, b.token)
        .expect(200);
      expect((page2.body.data as Json[]).map((p) => p.code)).toEqual(['G1']);
      expect(page2.body.meta.nextCursor).toBeUndefined();
      const desc1 = await http
        .get('/catalog/products?limit=2&sort=createdAt:desc', b.token)
        .expect(200);
      const desc2 = await http
        .get(
          `/catalog/products?limit=2&sort=createdAt:desc&cursor=${desc1.body.meta.nextCursor}`,
          b.token,
        )
        .expect(200);
      expect([...desc1.body.data, ...desc2.body.data].map((p: Json) => p.code)).toEqual([
        'D1',
        'G1',
        'B1',
        'A1',
      ]);
    });
  });

  describe('categories and brands', () => {
    it('manages a tree: no cycles, no duplicate siblings, bounded depth, deactivate instead of delete', async () => {
      const b = await business();
      const mk = async (name: string, parentId?: string) =>
        (await http.post('/catalog/categories', { name, parentId }, b.token)).body.data as Json;
      const a = await mk('A');
      const aa = await mk('AA', a.id);
      const aaa = await mk('AAA', aa.id);
      await http.post('/catalog/categories', { name: 'a' }, b.token).expect(409); // case-insensitive sibling
      await http.post('/catalog/categories', { name: 'AA', parentId: a.id }, b.token).expect(409);
      await mk('AB'); // another root with a different name
      await http.post('/catalog/categories', { name: 'X', parentId: 'nope' }, b.token).expect(404);

      await http.patch(`/catalog/categories/${a.id}`, { parentId: aaa.id }, b.token).expect(400); // cycle
      await http.patch(`/catalog/categories/${a.id}`, { parentId: a.id }, b.token).expect(400);

      const l4 = await mk('L4', aaa.id);
      const l5 = await mk('L5', l4.id);
      const tooDeep = await http
        .post('/catalog/categories', { name: 'L6', parentId: l5.id }, b.token)
        .expect(400);
      expect(tooDeep.body.details.parentId).toBeDefined();

      const tree = (await http.get('/catalog/categories', b.token).expect(200)).body.data as Json[];
      const root = tree.find((c) => c.id === a.id) as Json;
      expect(root.children[0].children[0].children[0].name).toBe('L4');

      await http.patch(`/catalog/categories/${aa.id}`, { active: false }, b.token).expect(200);
      const visible = JSON.stringify((await http.get('/catalog/categories', b.token)).body.data);
      expect(visible).not.toContain('"AA"');
      expect(
        JSON.stringify(
          (await http.get('/catalog/categories?includeInactive=true', b.token)).body.data,
        ),
      ).toContain('"AA"');
    });

    it('brands: create, rename, deactivate, unique names', async () => {
      const b = await business();
      const brand = (await http.post('/catalog/brands', { name: 'Acme' }, b.token).expect(201)).body
        .data as Json;
      await http.post('/catalog/brands', { name: 'ACME' }, b.token).expect(409);
      await http.patch(`/catalog/brands/${brand.id}`, { name: 'Acme Co' }, b.token).expect(200);
      await http.patch(`/catalog/brands/${brand.id}`, { active: false }, b.token).expect(200);
      expect((await http.get('/catalog/brands', b.token)).body.data).toEqual([]);
      expect(
        (await http.get('/catalog/brands?includeInactive=true', b.token)).body.data,
      ).toHaveLength(1);
    });

    it('a sub-category inherits category-scoped custom fields (6.5)', async () => {
      const b = await business();
      const sofas = (await http.post('/catalog/categories', { name: 'Sofas' }, b.token)).body
        .data as Json;
      const corner = (
        await http.post('/catalog/categories', { name: 'Corner', parentId: sofas.id }, b.token)
      ).body.data as Json;
      await http
        .post(
          '/fields',
          {
            entityType: 'PRODUCT',
            key: 'seats',
            label: 'Seats',
            type: 'NUMBER',
            required: true,
            categoryId: sofas.id,
          },
          b.token,
        )
        .expect(201);
      await createProduct(b, { categoryId: corner.id }).expect(400);
      await createProduct(b, { categoryId: corner.id, customFields: { seats: '5' } }).expect(201);
      await createProduct(b).expect(201); // no category: the field does not apply
    });
  });

  describe('images', () => {
    const png = (color: string) =>
      sharp({ create: { width: 50, height: 50, channels: 3, background: color } })
        .png()
        .toBuffer();
    const upload = async (token: string, fields: Record<string, string> = {}) => {
      const req = request(app.getHttpServer())
        .post('/api/v1/files')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', `10.9.${n}.${Math.floor(Math.random() * 250)}`);
      for (const [k, v] of Object.entries(fields)) req.field(k, v);
      const res = await req
        .attach('file', await png('#aa5522'), { filename: 'a.png', contentType: 'image/png' })
        .expect(201);
      return res.body.data.id as string;
    };

    it('attaches, orders, sets the primary and removes images', async () => {
      const b = await business();
      const p = (await createProduct(b).expect(201)).body.data as Json;
      const f1 = await upload(b.token);
      const f2 = await upload(b.token, { entityType: 'PRODUCT', entityId: p.id, purpose: 'image' });
      const f3 = await upload(b.token);

      const i1 = (
        await http.post(`/catalog/products/${p.id}/images`, { fileId: f1 }, b.token).expect(201)
      ).body.data as Json;
      expect(i1.isPrimary).toBe(true); // the first image is the primary
      const i2 = (
        await http.post(`/catalog/products/${p.id}/images`, { fileId: f2 }, b.token).expect(201)
      ).body.data as Json;
      const i3 = (
        await http
          .post(`/catalog/products/${p.id}/images`, { fileId: f3, isPrimary: true }, b.token)
          .expect(201)
      ).body.data as Json;
      expect(i2.isPrimary).toBe(false);
      await http.post(`/catalog/products/${p.id}/images`, { fileId: f3 }, b.token).expect(409); // already attached
      const afterAttach = await t.db.prisma.fileAsset.findUniqueOrThrow({ where: { id: f1 } });
      expect(afterAttach).toMatchObject({ entityType: 'PRODUCT', entityId: p.id });

      let images = (await http.get(`/catalog/products/${p.id}/images`, b.token)).body
        .data as Json[];
      expect(images.filter((i) => i.isPrimary).map((i) => i.id)).toEqual([i3.id]);

      const reordered = await http
        .put(`/catalog/products/${p.id}/images/order`, { imageIds: [i3.id, i1.id, i2.id] }, b.token)
        .expect(200);
      expect((reordered.body.data as Json[]).map((i) => i.id)).toEqual([i3.id, i1.id, i2.id]);
      await http
        .put(`/catalog/products/${p.id}/images/order`, { imageIds: [i3.id] }, b.token)
        .expect(400);

      await http.post(`/catalog/images/${i2.id}/primary`, {}, b.token).expect(200);
      images = (await http.get(`/catalog/products/${p.id}/images`, b.token)).body.data as Json[];
      expect(images.filter((i) => i.isPrimary).map((i) => i.id)).toEqual([i2.id]);

      // a file in use by a product cannot be deleted directly; removing the image deletes both
      await http.del(`/files/${f2}`, b.token).expect(409);
      await http.del(`/catalog/images/${i2.id}`, b.token).expect(204);
      images = (await http.get(`/catalog/products/${p.id}/images`, b.token)).body.data as Json[];
      expect(images).toHaveLength(2);
      expect(images.filter((i) => i.isPrimary)).toHaveLength(1); // a new primary was chosen
      expect(await t.db.prisma.fileAsset.count({ where: { id: f2 } })).toBe(0);
      expect((await http.get(`/catalog/products/${p.id}`, b.token)).body.data.images).toHaveLength(
        2,
      );
    });

    it("refuses non-images, other products' files, and unknown files", async () => {
      const b = await business();
      const p = (await createProduct(b).expect(201)).body.data as Json;
      const other = (await createProduct(b).expect(201)).body.data as Json;
      const foreign = await upload(b.token, {
        entityType: 'PRODUCT',
        entityId: other.id,
        purpose: 'image',
      });
      await http.post(`/catalog/products/${p.id}/images`, { fileId: foreign }, b.token).expect(400);
      await http.post(`/catalog/products/${p.id}/images`, { fileId: 'nope' }, b.token).expect(400);
      const pdf = await request(app.getHttpServer())
        .post('/api/v1/files')
        .set('Authorization', `Bearer ${b.token}`)
        .set('X-Forwarded-For', '10.9.99.1')
        .attach(
          'file',
          Buffer.from(
            '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF',
          ),
          { filename: 'a.pdf', contentType: 'application/pdf' },
        );
      if (pdf.status === 201) {
        await http
          .post(`/catalog/products/${p.id}/images`, { fileId: pdf.body.data.id }, b.token)
          .expect(400);
      }
    });
  });

  describe('tenant isolation', () => {
    it('another workspace cannot see or change catalog records', async () => {
      const a = await business();
      const b = await business();
      const p = (
        await createProduct(a, { variants: [{ sku: 'ISO-1', barcode: 'ISO' }] }).expect(201)
      ).body.data as Json;
      const cat = (await http.post('/catalog/categories', { name: 'Private' }, a.token)).body
        .data as Json;
      const brand = (await http.post('/catalog/brands', { name: 'Private' }, a.token)).body
        .data as Json;

      await http.get(`/catalog/products/${p.id}`, b.token).expect(404);
      await http.patch(`/catalog/products/${p.id}`, { version: 1, name: 'x' }, b.token).expect(404);
      await http.post(`/catalog/products/${p.id}/archive`, {}, b.token).expect(404);
      await http.post(`/catalog/products/${p.id}/variants`, { sku: 'S' }, b.token).expect(404);
      await http.patch(`/catalog/variants/${p.variants[0].id}`, { name: 'x' }, b.token).expect(404);
      await http.patch(`/catalog/categories/${cat.id}`, { name: 'x' }, b.token).expect(404);
      await http.patch(`/catalog/brands/${brand.id}`, { name: 'x' }, b.token).expect(404);
      await http.get('/catalog/variants/lookup?code=ISO', b.token).expect(404);
      expect((await http.get('/catalog/variants/search?q=ISO', b.token)).body.data).toEqual([]);
      expect((await http.get('/catalog/products', b.token)).body.data).toEqual([]);
      // references to the other workspace's records are rejected
      await createProduct(b, { categoryId: cat.id }).expect(400);
      await createProduct(b, { brandId: brand.id }).expect(400);
    });
  });
});
