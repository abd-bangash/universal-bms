import request from 'supertest';
import sharp from 'sharp';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

/** Checkpoint 22: the products journey from the task list, end to end through the HTTP API. */
describe('Checkpoint — products', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
  }, 90_000);
  afterAll(() => t.close());

  async function owner(n: number) {
    const email = `owner${n}@checkpoint.test`;
    await t.app.get(TenantsService).createWorkspace({
      name: `Checkpoint ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
    });
    const login = await http
      .post('/auth/login', { email, password: 'owner-password-1' })
      .expect(200);
    return login.body.data.accessToken as string;
  }

  it('creates a product with size and material attributes, generates variants, adds an image, archives another, and nothing leaks to a second workspace', async () => {
    const a = await owner(1);
    const b = await owner(2);

    // the furniture profile brought the attribute definitions and the category tree
    const fields = (await http.get('/fields?entityType=PRODUCT', a).expect(200)).body
      .data as Json[];
    expect(fields.map((f) => f.key)).toEqual(
      expect.arrayContaining(['width', 'depth', 'height', 'material', 'finish']),
    );
    const categories = (await http.get('/catalog/categories', a).expect(200)).body.data as Json[];
    const sofas = categories.find((c) => c.name === 'Sofas') as Json;
    const sectional = sofas.children.find((c: Json) => c.name === 'Sectional sofas') as Json;

    // 1. a product with custom size and material attributes
    const created = await http
      .post(
        '/catalog/products',
        {
          code: 'CP-SOFA',
          name: 'Checkpoint Corner Sofa',
          categoryId: sectional.id,
          basePrice: '145000.00',
          aliases: ['corner couch'],
          customFields: {
            width: { value: '280', unit: 'cm' },
            depth: { value: '180', unit: 'cm' },
            height: { value: '85', unit: 'cm' },
            material: 'fabric',
            finish: 'upholstered',
          },
        },
        a,
      )
      .expect(201);
    const product = created.body.data as Json;
    expect(product.customFields).toMatchObject({
      material: 'fabric',
      width: { value: '280', unit: 'cm' },
    });
    // an invalid attribute is refused with a field-level error
    const bad = await http
      .post(
        '/catalog/products',
        {
          code: 'CP-BAD',
          name: 'Bad',
          basePrice: '1',
          customFields: { material: 'plastic', width: { value: '1', unit: 'kg' } },
        },
        a,
      )
      .expect(400);
    expect(Object.keys(bad.body.details)).toEqual(
      expect.arrayContaining(['customFields.material', 'customFields.width']),
    );

    // 2. generate variants from the colour and material axes
    const generated = await http
      .post(
        `/catalog/products/${product.id}/generate-variants`,
        {
          axes: [
            { key: 'color', optionKeys: ['grey', 'beige'] },
            { key: 'material', optionKeys: ['fabric', 'leather'] },
          ],
        },
        a,
      )
      .expect(200);
    expect((generated.body.data.created as Json[]).map((v) => v.sku).sort()).toEqual([
      'CP-SOFA-beige-fabric',
      'CP-SOFA-beige-leather',
      'CP-SOFA-grey-fabric',
      'CP-SOFA-grey-leather',
    ]);

    // 3. upload an image and attach it
    const png = await sharp({
      create: { width: 80, height: 60, channels: 3, background: '#335577' },
    })
      .png()
      .toBuffer();
    const upload = await request(t.app.getHttpServer())
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${a}`)
      .set('X-Forwarded-For', '10.55.0.1')
      .field('entityType', 'PRODUCT')
      .field('entityId', product.id)
      .field('purpose', 'image')
      .attach('file', png, { filename: 'sofa.png', contentType: 'image/png' })
      .expect(201);
    const image = await http
      .post(`/catalog/products/${product.id}/images`, { fileId: upload.body.data.id }, a)
      .expect(201);
    expect(image.body.data.isPrimary).toBe(true);
    const url = await http.get(`/files/${upload.body.data.id}/url`, a).expect(200);
    expect(url.body.data.url).toContain('http');

    // 4. archive another product
    const other = (
      await http
        .post('/catalog/products', { code: 'CP-OLD', name: 'Old Chair', basePrice: '9000' }, a)
        .expect(201)
    ).body.data as Json;
    await http.post(`/catalog/products/${other.id}/archive`, {}, a).expect(200);
    const listed = (await http.get('/catalog/products', a).expect(200)).body.data as Json[];
    expect(listed.map((p) => p.code)).toEqual(['CP-SOFA']);
    expect(
      ((await http.get('/catalog/products?status=ARCHIVED', a)).body.data as Json[]).map(
        (p) => p.code,
      ),
    ).toEqual(['CP-OLD']);
    const full = (await http.get(`/catalog/products/${product.id}`, a).expect(200)).body
      .data as Json;
    expect(full.variants.filter((v: Json) => v.status === 'ACTIVE')).toHaveLength(4);
    expect(full.images).toHaveLength(1);

    // 5. the second workspace sees none of it
    expect((await http.get('/catalog/products', b).expect(200)).body.data).toEqual([]);
    expect((await http.get('/catalog/products?status=ARCHIVED', b).expect(200)).body.data).toEqual(
      [],
    );
    await http.get(`/catalog/products/${product.id}`, b).expect(404);
    await http.get(`/files/${upload.body.data.id}/url`, b).expect(404);
    expect((await http.get('/catalog/variants/search?q=sofa', b).expect(200)).body.data).toEqual(
      [],
    );
    await http.get('/catalog/variants/lookup?code=CP-SOFA-grey-fabric', b).expect(404);
    await http
      .post(`/catalog/products/${product.id}/images`, { fileId: upload.body.data.id }, b)
      .expect(404);
  });
});
