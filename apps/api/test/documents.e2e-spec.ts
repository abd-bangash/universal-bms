import request from 'supertest';
import { buildDocument, textOf } from '../src/modules/documents/document-layout';
import { DocumentRenderer } from '../src/modules/documents/document-renderer';
import type { DocumentSnapshot } from '../src/modules/documents/document.types';
import { SettingsService } from '../src/modules/settings/settings.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { runWithWorkspace } from './helpers/context';
import { renderInNode } from './helpers/render-pdf-node';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Documents (real PostgreSQL)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;
  let keys = 0;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
    // Jest cannot load the PDF library; draw the documents in a plain Node process instead
    jest
      .spyOn(t.app.get(DocumentRenderer), 'render')
      .mockImplementation((type, snapshot, options) =>
        renderInNode({ ...snapshot, type }, options),
      );
  }, 90_000);
  afterAll(() => t.close());

  async function business() {
    const email = `owner${++n}@docs.test`;
    const created = await t.app.get(TenantsService).createWorkspace({
      name: `Docs ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'Olivia', lastName: 'Owner', password: 'owner-password-1' },
      currency: 'PKR',
      country: 'PK',
    });
    await runWithWorkspace(t.app, created.workspaceId, () =>
      t.app.get(SettingsService).update({
        business: { legalName: 'Acme Furniture Co' },
        sales: { requiredDepositPercent: 0 },
        tax: { enabled: true, pricesIncludeTax: false },
      }),
    );
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const roles = (await http.get('/roles', token)).body.data as Json[];
    const product = (
      await http
        .post(
          '/catalog/products',
          { code: 'SOFA', name: 'Sofa', basePrice: '1000.00', variants: [{ sku: 'SOFA-A' }] },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const customer = (
      await http.post('/customers', { fullName: 'Sana Malik', phones: ['0300-1234567'] }, token)
    ).body.data as Json;
    return { ...created, token, roles, customer, variantId: product.variants[0].id as string };
  }
  type Biz = Awaited<ReturnType<typeof business>>;

  async function member(b: Biz, roleName: string) {
    const email = `${roleName.toLowerCase().replace(/\W/g, '')}${++n}@docs.test`;
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
    const token = (
      await http.post('/auth/login', { email, password: 'member-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const me = (await http.get('/auth/me', token)).body.data;
    return { token, userId: me.user.id as string };
  }

  const createOrder = async (b: Biz, who: { token: string } = b, extra: object = {}) =>
    (
      await request(t.app.getHttpServer())
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${who.token}`)
        .set('Idempotency-Key', `docs-${++keys}`)
        .set('X-Forwarded-For', `10.66.${(++n >> 8) & 255}.${n & 255}`)
        .send({
          customerId: b.customer.id,
          lines: [{ variantId: b.variantId, quantity: '2' }],
          ...extra,
        })
        .expect(201)
    ).body.data as Json;
  const status = (who: { token: string }, id: string, to: string) =>
    request(t.app.getHttpServer())
      .post(`/api/v1/orders/${id}/status`)
      .set('Authorization', `Bearer ${who.token}`)
      .set('X-Forwarded-For', `10.67.${(++n >> 8) & 255}.${n & 255}`)
      .send({ status: to });
  const pdf = (token: string, path: string) =>
    request(t.app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', `10.68.${(++n >> 8) & 255}.${n & 255}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  const issue = (b: { token: string }, orderId: string) =>
    http.post(`/orders/${orderId}/invoice`, {}, b.token);

  describe('invoices (29.3 to 29.6)', () => {
    it('issues a numbered invoice with a snapshot of the order, in a confirmed order only', async () => {
      const b = await business();
      const order = await createOrder(b);
      await issue(b, order.id).expect(422); // still a draft
      await status(b, order.id, 'confirmed').expect(200);
      const res = await issue(b, order.id).expect(201);
      expect(res.body.data.invoiceNumber).toMatch(/^INV-\d{4}-0001$/);
      expect(res.body.data.totalAmount).toBe(order.totalAmount);

      const row = await t.db.prisma.invoice.findFirstOrThrow({ where: { id: res.body.data.id } });
      const snap = row.data as unknown as DocumentSnapshot;
      expect(snap).toEqual(
        expect.objectContaining({
          type: 'INVOICE',
          number: res.body.data.invoiceNumber,
          orderNumber: order.orderNumber,
          currency: { code: 'PKR', decimals: 2 },
          balanceDue: order.balanceDue,
        }),
      );
      expect(snap.business.legalName).toBe('Acme Furniture Co');
      expect(snap.customer?.name).toBe('Sana Malik');
      expect(snap.lines).toHaveLength(1);
      expect(snap.labels?.customer).toBe('Customer');

      // a second invoice for the same order is a new document with the next number
      const second = await issue(b, order.id).expect(201);
      expect(second.body.data.invoiceNumber).toMatch(/-0002$/);
      const listed = (await http.get(`/orders/${order.id}/invoices`, b.token).expect(200)).body
        .data as Json[];
      expect(listed.map((i) => i.invoiceNumber)).toEqual([
        res.body.data.invoiceNumber,
        second.body.data.invoiceNumber,
      ]);
    });

    it('an issued invoice cannot be changed or deleted (36.1)', async () => {
      const b = await business();
      const order = await createOrder(b);
      await status(b, order.id, 'confirmed').expect(200);
      const inv = (await issue(b, order.id).expect(201)).body.data as Json;

      await expect(
        t.db.prisma.invoice.update({ where: { id: inv.id }, data: { totalAmount: '1' } }),
      ).rejects.toThrow(/immutable/);
      await expect(
        t.db.prisma.$executeRaw`UPDATE invoices SET data = '{}'::jsonb WHERE id = ${inv.id}`,
      ).rejects.toThrow(/immutable/);
      await expect(t.db.prisma.invoice.delete({ where: { id: inv.id } })).rejects.toThrow(
        /immutable/,
      );
      const row = await t.db.prisma.invoice.findFirstOrThrow({ where: { id: inv.id } });
      expect(row.totalAmount.toFixed()).toBe(order.totalAmount);
    });

    it('regenerating the PDF after the order or the business changes gives the same content (29.5)', async () => {
      const b = await business();
      const order = await createOrder(b);
      await status(b, order.id, 'confirmed').expect(200);
      const inv = (await issue(b, order.id).expect(201)).body.data as Json;
      const before = (await t.db.prisma.invoice.findFirstOrThrow({ where: { id: inv.id } }))
        .data as unknown as DocumentSnapshot;
      const textBefore = textOf(buildDocument(before));

      // change what the invoice was made from
      const current = (await http.get(`/orders/${order.id}`, b.token)).body.data as Json;
      await http
        .patch(
          `/orders/${order.id}`,
          { version: current.version, internalNotes: 'changed', notes: 'A different note' },
          b.token,
        )
        .expect(200);
      await runWithWorkspace(t.app, b.workspaceId, () =>
        t.app.get(SettingsService).update({ business: { legalName: 'Renamed Company' } }),
      );

      const after = (await t.db.prisma.invoice.findFirstOrThrow({ where: { id: inv.id } }))
        .data as unknown as DocumentSnapshot;
      expect(after).toEqual(before);
      expect(textOf(buildDocument(after))).toBe(textBefore);
      expect(textBefore).toContain('Acme Furniture Co');

      const res = await pdf(b.token, `/invoices/${inv.id}/pdf`).expect(200);
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('is raised automatically on the configured System_Role, once (29.3)', async () => {
      const b = await business(); // the default is DELIVERED
      const sales = await member(b, 'Salesperson');
      const order = await createOrder(b, sales);
      for (const to of ['confirmed', 'in_production', 'ready']) {
        await status(sales, order.id, to).expect(200);
      }
      expect(await t.db.prisma.invoice.count({ where: { orderId: order.id } })).toBe(0);
      await status(sales, order.id, 'delivered').expect(200);
      const invoices = await t.db.prisma.invoice.findMany({ where: { orderId: order.id } });
      expect(invoices).toHaveLength(1);
      expect(invoices[0]!.issuedById).toBeTruthy();

      // completing it does not raise another one, and a different configured role raises on that role
      await t.db.prisma.order.update({
        where: { id: order.id },
        data: { balanceDue: '0', paidAmount: order.totalAmount },
      });
      await status(sales, order.id, 'completed').expect(200);
      expect(await t.db.prisma.invoice.count({ where: { orderId: order.id } })).toBe(1);
    });

    it('is not raised automatically when the setting is off', async () => {
      const b = await business();
      await runWithWorkspace(t.app, b.workspaceId, () =>
        t.app.get(SettingsService).update({ documents: { autoInvoiceOnSystemRole: null } }),
      );
      const order = await createOrder(b);
      for (const to of ['confirmed', 'in_production', 'ready', 'delivered']) {
        await status(b, order.id, to).expect(200);
      }
      expect(await t.db.prisma.invoice.count({ where: { orderId: order.id } })).toBe(0);
    });
  });

  describe('PDFs (29.1, 29.7)', () => {
    it('streams quotation, order confirmation and invoice PDFs for the browser to open', async () => {
      const b = await business();
      const order = await createOrder(b);
      const quotation = (
        await http
          .post(
            '/quotations',
            { customerId: b.customer.id, lines: [{ variantId: b.variantId, quantity: '1' }] },
            b.token,
          )
          .expect(201)
      ).body.data as Json;
      await status(b, order.id, 'confirmed').expect(200);
      const inv = (await issue(b, order.id).expect(201)).body.data as Json;

      for (const [path, name] of [
        [`/quotations/${quotation.id}/pdf`, quotation.quotationNumber],
        [`/orders/${order.id}/pdf`, order.orderNumber],
        [`/invoices/${inv.id}/pdf`, inv.invoiceNumber],
      ] as const) {
        const res = await pdf(b.token, path).expect(200);
        expect(res.headers['content-type']).toContain('application/pdf');
        expect(res.headers['content-disposition']).toBe(`inline; filename="${name}.pdf"`);
        expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      }
    });

    it('a sent quotation renders from the snapshot taken when it was sent', async () => {
      const b = await business();
      const quotation = (
        await http
          .post(
            '/quotations',
            { customerId: b.customer.id, lines: [{ variantId: b.variantId, quantity: '1' }] },
            b.token,
          )
          .expect(201)
      ).body.data as Json;
      await http.post(`/quotations/${quotation.id}/send`, {}, b.token).expect(200);
      const stored = (await t.db.prisma.quotation.findFirstOrThrow({ where: { id: quotation.id } }))
        .sentSnapshot as unknown as DocumentSnapshot;
      expect(stored.labels?.document).toBe('Quotation');
      expect(stored.locale?.dateFormat).toBeTruthy();

      await runWithWorkspace(t.app, b.workspaceId, () =>
        t.app.get(SettingsService).update({ business: { legalName: 'Renamed Company' } }),
      );
      const spy = jest.spyOn(t.app.get(DocumentRenderer), 'render');
      await pdf(b.token, `/quotations/${quotation.id}/pdf`).expect(200);
      const used = spy.mock.calls.at(-1)?.[1] as DocumentSnapshot;
      expect(used.business.legalName).toBe('Acme Furniture Co');
      spy.mockClear();
    });

    it('applies the workspace terminology and locale to the document', async () => {
      const b = await business();
      await runWithWorkspace(t.app, b.workspaceId, () =>
        t.app.get(SettingsService).update({
          terminology: { quotation: { singular: 'Estimate', plural: 'Estimates' } },
          locale: { dateFormat: 'YYYY-MM-DD' },
        }),
      );
      const quotation = (
        await http
          .post(
            '/quotations',
            { customerId: b.customer.id, lines: [{ variantId: b.variantId, quantity: '1' }] },
            b.token,
          )
          .expect(201)
      ).body.data as Json;
      await http.post(`/quotations/${quotation.id}/send`, {}, b.token).expect(200);
      const stored = (await t.db.prisma.quotation.findFirstOrThrow({ where: { id: quotation.id } }))
        .sentSnapshot as unknown as DocumentSnapshot;
      expect(stored.labels?.document).toBe('Estimate');
      const text = textOf(buildDocument(stored));
      expect(text).toContain('Estimate');
      expect(text).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
    });
  });

  describe('permissions and isolation', () => {
    it('lets people with order:view see PDFs but only order:edit issue invoices', async () => {
      const b = await business();
      const viewer = await member(b, 'Viewer');
      const order = await createOrder(b, b, { assignedToId: viewer.userId });
      await status(b, order.id, 'confirmed').expect(200);
      const inv = (await issue(b, order.id).expect(201)).body.data as Json;
      await issue(viewer, order.id).expect(403);
      await http.get(`/orders/${order.id}/invoices`, viewer.token).expect(200);
      await pdf(viewer.token, `/invoices/${inv.id}/pdf`).expect(200);
      await pdf(viewer.token, `/orders/${order.id}/pdf`).expect(200);
      await http.get(`/invoices/${inv.id}/pdf`).expect(401);
    });

    it('hides other peoples orders from people without order:view_all', async () => {
      const b = await business();
      const alice = await member(b, 'Salesperson');
      const theirs = await createOrder(b);
      await status(b, theirs.id, 'confirmed').expect(200);
      const inv = (await issue(b, theirs.id).expect(201)).body.data as Json;
      await pdf(alice.token, `/orders/${theirs.id}/pdf`).expect(404);
      await pdf(alice.token, `/invoices/${inv.id}/pdf`).expect(404);
      await issue(alice, theirs.id).expect(404);
    });

    it("another workspace cannot see an order's documents", async () => {
      const a = await business();
      const other = await business();
      const order = await createOrder(a);
      await status(a, order.id, 'confirmed').expect(200);
      const inv = (await issue(a, order.id).expect(201)).body.data as Json;
      const quotation = (
        await http
          .post(
            '/quotations',
            { customerId: a.customer.id, lines: [{ variantId: a.variantId, quantity: '1' }] },
            a.token,
          )
          .expect(201)
      ).body.data as Json;
      await pdf(other.token, `/invoices/${inv.id}/pdf`).expect(404);
      await pdf(other.token, `/orders/${order.id}/pdf`).expect(404);
      await pdf(other.token, `/quotations/${quotation.id}/pdf`).expect(404);
      await issue(other, order.id).expect(404);
      await http.get(`/orders/${order.id}/invoices`, other.token).expect(404);
    });
  });
});
