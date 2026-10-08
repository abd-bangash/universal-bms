import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Pricing preview (real PostgreSQL)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
  }, 90_000);
  afterAll(() => t.close());

  async function business() {
    const email = `owner${++n}@pricing.test`;
    await t.app.get(TenantsService).createWorkspace({
      name: `Pricing ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      currency: 'PKR',
      country: 'PK',
    });
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const roles = (await http.get('/roles', token)).body.data as Json[];
    const product = (
      await http
        .post(
          '/catalog/products',
          {
            code: 'SOFA',
            name: 'Sofa',
            basePrice: '1000.00',
            variants: [
              { sku: 'SOFA-A' },
              { sku: 'SOFA-B', priceOverride: '1200.00', name: 'Large' },
            ],
          },
          token,
        )
        .expect(201)
    ).body.data as Json;
    return { token, roles, product, variants: product.variants as Json[] };
  }
  type Biz = Awaited<ReturnType<typeof business>>;

  async function member(b: Biz, roleName: string) {
    const email = `${roleName.toLowerCase().replace(/\W/g, '')}${++n}@pricing.test`;
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
    return (await http.post('/auth/login', { email, password: 'member-password-1' }).expect(200))
      .body.data.accessToken as string;
  }
  const variantId = (b: Biz, sku: string) =>
    (b.variants.find((v) => v.sku === sku) as Json).id as string;
  const preview = (token: string, body: object) => http.post('/pricing/preview', body, token);

  it('prices catalog lines from the variant override, else the product price (35.1)', async () => {
    const b = await business();
    const res = await preview(b.token, {
      lines: [
        { variantId: variantId(b, 'SOFA-A'), quantity: '2' },
        { variantId: variantId(b, 'SOFA-B'), quantity: '1' },
      ],
    }).expect(200);
    expect(res.body.data.lines.map((l: Json) => [l.listPrice, l.unitPrice, l.lineTotal])).toEqual([
      ['1000', '1000', '2000.00'],
      ['1200', '1200', '1200.00'],
    ]);
    expect(res.body.data).toMatchObject({
      subtotal: '3200.00',
      discountAmount: '0.00',
      taxAmount: '0.00',
      total: '3200.00',
    });
    expect(res.body.data.lines[1].name).toBe('Sofa — Large');
    expect(typeof res.body.data.total).toBe('string');
  });

  it('applies line and order discounts, and a custom line', async () => {
    const b = await business();
    const res = await preview(b.token, {
      lines: [
        {
          variantId: variantId(b, 'SOFA-A'),
          quantity: '1',
          discount: { type: 'PERCENT', value: '10' },
        },
        { kind: 'CUSTOM', name: 'Made-to-measure cabinet', quantity: '1', unitPrice: '5000.00' },
      ],
      orderDiscount: { type: 'AMOUNT', value: '100.00' },
    }).expect(200);
    expect(
      res.body.data.lines.map((l: Json) => [
        l.lineDiscountAmount,
        l.allocatedDiscount,
        l.lineTotal,
      ]),
    ).toEqual([
      ['100.00', '15.25', '884.75'],
      ['0.00', '84.75', '4915.25'],
    ]);
    expect(res.body.data).toMatchObject({
      subtotal: '6000.00',
      discountAmount: '200.00',
      orderDiscountAmount: '100.00',
      total: '5800.00',
    });
  });

  it("uses the tax class and the workspace's tax-inclusive or exclusive setting (35.5)", async () => {
    const b = await business();
    const taxClass = (
      await http
        .post('/settings/tax-classes', { name: 'GST 17%', rate: '0.17' }, b.token)
        .expect(201)
    ).body.data as Json;
    await http
      .patch(`/catalog/products/${b.product.id}`, { version: 1, taxClassId: taxClass.id }, b.token)
      .expect(200);
    const line = { lines: [{ variantId: variantId(b, 'SOFA-A'), quantity: '1' }] };

    // tax is off until the workspace turns it on
    expect((await preview(b.token, line).expect(200)).body.data).toMatchObject({
      taxAmount: '0.00',
      total: '1000.00',
    });
    await http
      .patch('/settings', { tax: { enabled: true, pricesIncludeTax: false } }, b.token)
      .expect(200);
    const exclusive = (await preview(b.token, line).expect(200)).body.data;
    expect(exclusive).toMatchObject({ taxAmount: '170.00', total: '1170.00', subtotal: '1000.00' });
    expect(exclusive.taxBreakdown).toEqual([
      { rate: '0.17', taxableAmount: '1000.00', taxAmount: '170.00' },
    ]);
    expect(exclusive.lines[0].taxRate).toBe('0.17');

    await http
      .patch('/settings', { tax: { enabled: true, pricesIncludeTax: true } }, b.token)
      .expect(200);
    const inclusive = (await preview(b.token, line).expect(200)).body.data;
    expect(inclusive).toMatchObject({ total: '1000.00', taxAmount: '145.30' });
    expect(inclusive.lines[0].netExcludingTax).toBe('854.70');
  });

  it('rounds cash payments to the workspace increment (35.7)', async () => {
    const b = await business();
    await http.patch('/settings', { sales: { cashRoundingIncrement: 5 } }, b.token).expect(200);
    const line = { lines: [{ kind: 'CUSTOM', name: 'Odd', quantity: '1', unitPrice: '1233.00' }] };
    expect((await preview(b.token, line).expect(200)).body.data).toMatchObject({
      roundingAmount: '0.00',
      total: '1233.00',
    });
    expect((await preview(b.token, { ...line, cash: true }).expect(200)).body.data).toMatchObject({
      roundingAmount: '2.00',
      total: '1235.00',
    });
  });

  describe('price overrides (35.9)', () => {
    it('need order:price_override, and name the original and new price', async () => {
      const b = await business();
      const sales = await member(b, 'Salesperson'); // no price override
      const line = {
        lines: [{ variantId: variantId(b, 'SOFA-A'), quantity: '1', unitPrice: '900.00' }],
      };
      const denied = await preview(sales, line).expect(403);
      expect(denied.body.details['lines[0].unitPrice']).toBeDefined();
      // sending the list price unchanged is not an override
      await preview(sales, {
        lines: [{ variantId: variantId(b, 'SOFA-A'), quantity: '1', unitPrice: '1000.00' }],
      }).expect(200);

      const res = await preview(b.token, line).expect(200);
      expect(res.body.data.lines[0]).toMatchObject({
        listPrice: '1000',
        unitPrice: '900.00',
        lineTotal: '900.00',
      });
      expect(res.body.data.overrides).toEqual([
        { lineNo: 1, variantId: variantId(b, 'SOFA-A'), original: '1000', price: '900.00' },
      ]);
    });
  });

  describe('discount limit (35.4)', () => {
    it("rejects a discount over the user's highest role limit, counting the order discount share", async () => {
      const b = await business();
      const sales = await member(b, 'Salesperson'); // 5 percent
      const variant = variantId(b, 'SOFA-A');
      await preview(sales, {
        lines: [{ variantId: variant, quantity: '1', discount: { type: 'PERCENT', value: '5' } }],
      }).expect(200);
      const over = await preview(sales, {
        lines: [{ variantId: variant, quantity: '1', discount: { type: 'PERCENT', value: '6' } }],
      }).expect(422);
      expect(over.body.code).toBe('DISCOUNT_OVER_LIMIT');
      expect(over.body.details['lines[0].discount'][0]).toMatch(/limit of 5/);
      // 3% on the line plus a 3% order discount is 5.91% effective
      await preview(sales, {
        lines: [{ variantId: variant, quantity: '1', discount: { type: 'PERCENT', value: '3' } }],
        orderDiscount: { type: 'PERCENT', value: '3' },
      }).expect(422);
      await preview(sales, {
        lines: [{ variantId: variant, quantity: '1' }],
        orderDiscount: { type: 'AMOUNT', value: '49.00' },
      }).expect(200);
      // the owner may give 100%
      await preview(b.token, {
        lines: [{ variantId: variant, quantity: '1', discount: { type: 'PERCENT', value: '50' } }],
      }).expect(200);
    });
  });

  describe('validation and access', () => {
    it('refuses bad lines with field-level errors', async () => {
      const b = await business();
      const variant = variantId(b, 'SOFA-A');
      await preview(b.token, { lines: [{ variantId: variant, quantity: 2 }] }).expect(400); // numbers are not accepted
      await preview(b.token, { lines: [{ variantId: variant, quantity: '0' }] }).expect(400);
      await preview(b.token, { lines: [{ variantId: variant, quantity: '-1' }] }).expect(400);
      const noName = await preview(b.token, {
        lines: [{ kind: 'CUSTOM', quantity: '1', unitPrice: '10' }],
      }).expect(400);
      expect(noName.body.details['lines[0].name']).toBeDefined();
      await preview(b.token, { lines: [{ kind: 'CUSTOM', name: 'x', quantity: '1' }] }).expect(400);
      await preview(b.token, { lines: [{ variantId: 'nope', quantity: '1' }] }).expect(400);
      await preview(b.token, { lines: [{ kind: 'CATALOG', quantity: '1' }] }).expect(400);
      await preview(b.token, {
        lines: [{ variantId: variant, quantity: '1', discount: { type: 'PERCENT', value: '150' } }],
      }).expect(400);
      await preview(b.token, {
        lines: [{ variantId: variant, quantity: '1' }],
        orderDiscount: { type: 'PERCENT', value: '101' },
      }).expect(400);
      expect((await preview(b.token, { lines: [] }).expect(200)).body.data.total).toBe('0.00');
    });

    it("refuses archived products with 422 and other workspaces' variants with 400", async () => {
      const a = await business();
      const other = await business();
      await http.post(`/catalog/products/${a.product.id}/archive`, {}, a.token).expect(200);
      const res = await preview(a.token, {
        lines: [{ variantId: variantId(a, 'SOFA-A'), quantity: '1' }],
      }).expect(422);
      expect(res.body.code).toBe('PRODUCT_ARCHIVED');
      await preview(other.token, {
        lines: [{ variantId: variantId(a, 'SOFA-A'), quantity: '1' }],
      }).expect(400);
    });

    it('needs a role that can create quotations, orders or sales', async () => {
      const b = await business();
      const viewer = await member(b, 'Viewer');
      const production = await member(b, 'Production Staff');
      const cashier = await member(b, 'Cashier');
      const body = { lines: [{ kind: 'CUSTOM', name: 'x', quantity: '1', unitPrice: '10' }] };
      await preview(viewer, body).expect(403);
      await preview(production, body).expect(403);
      await preview(cashier, body).expect(200);
      await http.post('/pricing/preview', body).expect(401);
    });
  });
});
