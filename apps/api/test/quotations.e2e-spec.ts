import request from 'supertest';
import sharp from 'sharp';
import { QuotationExpiryScheduler } from '../src/modules/sales/quotation-expiry.scheduler';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Quotations API (real PostgreSQL)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
  }, 90_000);
  afterAll(() => t.close());

  async function business() {
    const email = `owner${++n}@quotes.test`;
    const created = await t.app.get(TenantsService).createWorkspace({
      name: `Quotes ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'Olivia', lastName: 'Owner', password: 'owner-password-1' },
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
            variants: [{ sku: 'SOFA-A' }, { sku: 'SOFA-B', priceOverride: '1200.00' }],
          },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const customer = (
      await http.post('/customers', { fullName: 'Sana Malik', phones: ['0300-1234567'] }, token)
    ).body.data as Json;
    return {
      ...created,
      token,
      roles,
      customer,
      variants: product.variants as Json[],
    };
  }
  type Biz = Awaited<ReturnType<typeof business>>;

  async function member(b: Biz, roleName: string) {
    const email = `${roleName.toLowerCase().replace(/\W/g, '')}${++n}@quotes.test`;
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
    return login.body.data.accessToken as string;
  }

  const variantId = (b: Biz, sku: string) => b.variants.find((v) => v.sku === sku)?.id as string;
  const create = (b: Biz, body: object = {}) =>
    http.post(
      '/quotations',
      {
        customerId: b.customer.id,
        lines: [{ variantId: variantId(b, 'SOFA-A'), quantity: '2' }],
        ...body,
      },
      b.token,
    );
  const attach = async (b: Biz, entityType: string, entityId: string) => {
    const png = await sharp({
      create: { width: 30, height: 30, channels: 3, background: '#445566' },
    })
      .png()
      .toBuffer();
    return request(t.app.getHttpServer())
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${b.token}`)
      .set('X-Forwarded-For', `10.88.0.${++n % 250}`)
      .field('entityType', entityType)
      .field('entityId', entityId)
      .field('purpose', 'reference')
      .attach('file', png, { filename: 'idea.png', contentType: 'image/png' })
      .expect(201);
  };
  const toAccepted = async (b: Biz, id: string) => {
    await http.post(`/quotations/${id}/send`, {}, b.token).expect(200);
    await http.post(`/quotations/${id}/accept`, { via: 'PHONE' }, b.token).expect(200);
  };

  describe('create and edit (10.1, 10.2)', () => {
    it('prices the lines, numbers the quotation and sets the validity date', async () => {
      const b = await business();
      const res = await create(b, { notes: 'Delivery in 3 weeks' }).expect(201);
      const q = res.body.data as Json;
      expect(q.quotationNumber).toMatch(/^QT-\d{4}-0001$/);
      expect(q.status).toBe('DRAFT');
      expect(q.totalAmount).toBe('2000');
      expect(q.items).toHaveLength(1);
      expect(q.items[0]).toEqual(
        expect.objectContaining({ unitPrice: '1000', quantity: '2', lineTotal: '2000' }),
      );
      expect(q.validUntil).not.toBeNull();
      const second = (await create(b).expect(201)).body.data as Json;
      expect(second.quotationNumber).toMatch(/-0002$/);
    });

    it('supports custom lines and a custom validity date', async () => {
      const b = await business();
      const res = await create(b, {
        validUntil: '2099-01-31',
        lines: [
          { variantId: variantId(b, 'SOFA-B'), quantity: '1' },
          { kind: 'CUSTOM', name: 'Made-to-measure wardrobe', quantity: '1', unitPrice: '55000' },
        ],
      }).expect(201);
      expect(res.body.data.totalAmount).toBe('56200');
      expect(res.body.data.validUntil).toContain('2099-01-31');
    });

    it('edits a draft with the version check, replacing lines and recalculating', async () => {
      const b = await business();
      const q = (await create(b).expect(201)).body.data as Json;
      const edited = await http
        .patch(
          `/quotations/${q.id}`,
          { version: q.version, lines: [{ variantId: variantId(b, 'SOFA-B'), quantity: '3' }] },
          b.token,
        )
        .expect(200);
      expect(edited.body.data.totalAmount).toBe('3600');
      expect(edited.body.data.version).toBe(q.version + 1);
      await http
        .patch(`/quotations/${q.id}`, { version: q.version, notes: 'stale' }, b.token)
        .expect(409);
    });

    it('audits a price override and needs the permission for it (35.9)', async () => {
      const b = await business();
      const res = await create(b, {
        lines: [{ variantId: variantId(b, 'SOFA-A'), quantity: '1', unitPrice: '900' }],
      }).expect(201);
      expect(res.body.data.items[0].unitPrice).toBe('900');
      const audit = await t.db.prisma.auditEvent.findMany({
        where: { workspaceId: b.workspaceId, action: { contains: 'price_override' } },
      });
      expect(audit.length).toBeGreaterThan(0);

      const sales = await member(b, 'Salesperson');
      await http
        .post(
          '/quotations',
          {
            customerId: b.customer.id,
            lines: [{ variantId: variantId(b, 'SOFA-A'), quantity: '1', unitPrice: '500' }],
          },
          sales,
        )
        .expect(403);
    });

    it('refuses an empty quotation to be sent, and validates custom fields on lines', async () => {
      const b = await business();
      const empty = (await create(b, { lines: [] }).expect(201)).body.data as Json;
      await http.post(`/quotations/${empty.id}/send`, {}, b.token).expect(422);
      await http
        .post(
          '/fields',
          {
            entityType: 'QUOTATION_ITEM',
            key: 'fabric_note',
            label: 'Fabric',
            type: 'TEXT',
            required: true,
          },
          b.token,
        )
        .expect(201);
      const bad = await create(b).expect(400);
      expect(Object.keys(bad.body.details ?? {}).join()).toMatch(/fabric_note/);
      const ok = await create(b, {
        lines: [
          {
            variantId: variantId(b, 'SOFA-A'),
            quantity: '1',
            customFields: { fabric_note: 'Velvet' },
          },
        ],
      }).expect(201);
      expect(ok.body.data.items[0].customFields).toEqual({ fabric_note: 'Velvet' });
      expect(ok.body.data.items[0].fieldSnapshot).toBeTruthy();
    });
  });

  describe('send, accept, reject (10.3, 39.4)', () => {
    it('stores a snapshot when sent and still lets a sent quotation be edited in place', async () => {
      const b = await business();
      const q = (await create(b).expect(201)).body.data as Json;
      const sent = (await http.post(`/quotations/${q.id}/send`, {}, b.token).expect(200)).body
        .data as Json;
      expect(sent.status).toBe('SENT');
      expect(sent.sentVia).toBe('MANUAL');
      expect(sent.sentAt).not.toBeNull();
      const row = await t.db.prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });
      expect(row.sentSnapshot).toEqual(
        expect.objectContaining({ number: q.quotationNumber, type: 'QUOTATION' }),
      );
      const edit = await http
        .patch(`/quotations/${q.id}`, { version: sent.version, notes: 'Updated terms' }, b.token)
        .expect(200);
      expect(edit.body.data.notes).toBe('Updated terms');
    });

    it('accept records who, when, how and an optional attachment; only a sent quotation can be accepted', async () => {
      const b = await business();
      const q = (await create(b).expect(201)).body.data as Json;
      await http.post(`/quotations/${q.id}/accept`, { via: 'PHONE' }, b.token).expect(422);
      await http.post(`/quotations/${q.id}/send`, {}, b.token).expect(200);
      await http.post(`/quotations/${q.id}/accept`, { via: 'CARRIER_PIGEON' }, b.token).expect(400);
      const proof = (await attach(b, 'QUOTATION', q.id)).body.data as Json;
      const accepted = (
        await http
          .post(`/quotations/${q.id}/accept`, { via: 'MESSAGE', fileId: proof.id }, b.token)
          .expect(200)
      ).body.data as Json;
      expect(accepted.status).toBe('ACCEPTED');
      expect(accepted.acceptedVia).toBe('MESSAGE');
      expect(accepted.acceptanceRecordedById).toBeTruthy();
      expect(accepted.acceptedAt).not.toBeNull();
      expect(accepted.acceptanceFileId).toBe(proof.id);
      // an accepted quotation is no longer editable
      await http
        .patch(`/quotations/${q.id}`, { version: accepted.version, notes: 'x' }, b.token)
        .expect(422);
    });

    it('rejects with a reason, and refuses a second decision', async () => {
      const b = await business();
      const q = (await create(b).expect(201)).body.data as Json;
      await http.post(`/quotations/${q.id}/reject`, {}, b.token).expect(400);
      const rejected = await http
        .post(`/quotations/${q.id}/reject`, { reason: 'Too expensive' }, b.token)
        .expect(200);
      expect(rejected.body.data.status).toBe('REJECTED');
      expect(rejected.body.data.rejectedReason).toBe('Too expensive');
      await http.post(`/quotations/${q.id}/send`, {}, b.token).expect(422);
      await http.post(`/quotations/${q.id}/reject`, { reason: 'again' }, b.token).expect(422);
    });
  });

  describe('conversion to an order (34.1, 10.4, 10.5)', () => {
    it('preserves lines, prices, custom fields and attachments, in one step', async () => {
      const b = await business();
      await http
        .post(
          '/fields',
          { entityType: 'QUOTATION_ITEM', key: 'fabric_note', label: 'Fabric', type: 'TEXT' },
          b.token,
        )
        .expect(201);
      const q = (
        await create(b, {
          orderDiscount: { type: 'PERCENT', value: '10' },
          lines: [
            {
              variantId: variantId(b, 'SOFA-B'),
              quantity: '2',
              unitPrice: '1100',
              customFields: { fabric_note: 'Velvet' },
            },
            { kind: 'CUSTOM', name: 'Side table', quantity: '1', unitPrice: '5000' },
          ],
        }).expect(201)
      ).body.data as Json;
      const file = (await attach(b, 'QUOTATION', q.id)).body.data as Json;
      await toAccepted(b, q.id);

      const res = await http.post(`/quotations/${q.id}/convert`, {}, b.token).expect(200);
      const order = res.body.data.order as Json;
      expect(res.body.data.quotation.status).toBe('CONVERTED');
      expect(order.orderNumber).toMatch(/^ORD-\d{4}-0001$/);
      expect(order.totalAmount).toBe(q.totalAmount);
      expect(order.subtotal).toBe(q.subtotal);
      expect(order.customerId).toBe(b.customer.id);

      const quoteLines = await t.db.prisma.quotationItem.findMany({
        where: { quotationId: q.id },
        orderBy: { lineNo: 'asc' },
      });
      const orderLines = await t.db.prisma.orderItem.findMany({
        where: { orderId: order.id },
        orderBy: { lineNo: 'asc' },
      });
      expect(orderLines).toHaveLength(quoteLines.length);
      orderLines.forEach((line, i) => {
        const from = quoteLines[i]!;
        expect(line.name).toBe(from.name);
        expect(line.variantId).toBe(from.variantId);
        expect(line.quantity.toFixed()).toBe(from.quantity.toFixed());
        expect(line.unitPrice.toFixed()).toBe(from.unitPrice.toFixed());
        expect(line.lineTotal.toFixed()).toBe(from.lineTotal.toFixed());
        expect(line.customFields).toEqual(from.customFields);
        expect(line.fieldSnapshot).toEqual(from.fieldSnapshot);
      });
      expect(orderLines[0]!.customFields).toEqual({ fabric_note: 'Velvet' });

      const files = (await http.get(`/quotations/${q.id}/attachments`, b.token).expect(200)).body
        .data as Json[];
      expect(files.map((f) => f.id)).toContain(file.id);
      const orderFiles = await t.db.prisma.fileAsset.findMany({
        where: { entityType: 'ORDER', entityId: order.id },
      });
      expect(orderFiles).toHaveLength(1);
      expect(orderFiles[0]!.originalName).toBe('idea.png');

      // converting twice is refused and creates nothing more
      await http.post(`/quotations/${q.id}/convert`, {}, b.token).expect(422);
      expect(await t.db.prisma.order.count({ where: { workspaceId: b.workspaceId } })).toBe(1);
    });

    it('only an accepted quotation converts', async () => {
      const b = await business();
      const q = (await create(b).expect(201)).body.data as Json;
      await http.post(`/quotations/${q.id}/convert`, {}, b.token).expect(422);
      await http.post(`/quotations/${q.id}/send`, {}, b.token).expect(200);
      await http.post(`/quotations/${q.id}/convert`, {}, b.token).expect(422);
      expect(await t.db.prisma.order.count({ where: { workspaceId: b.workspaceId } })).toBe(0);
    });

    it('an expired quotation cannot be accepted or converted', async () => {
      const b = await business();
      const q = (await create(b).expect(201)).body.data as Json;
      await http.post(`/quotations/${q.id}/send`, {}, b.token).expect(200);
      await t.db.prisma.quotation.update({
        where: { id: q.id },
        data: { validUntil: new Date(Date.now() - 3 * 86_400_000) },
      });
      await http.post(`/quotations/${q.id}/accept`, { via: 'PHONE' }, b.token).expect(422);

      const result = await t.app.get(QuotationExpiryScheduler).scan();
      expect(result.failed).toEqual([]);
      const read = await http.get(`/quotations/${q.id}`, b.token).expect(200);
      expect(read.body.data.status).toBe('EXPIRED');
      await http.post(`/quotations/${q.id}/convert`, {}, b.token).expect(422);
      expect(await t.db.prisma.order.count({ where: { workspaceId: b.workspaceId } })).toBe(0);
    });

    it('a quotation made for a lead converts the lead to a customer', async () => {
      const b = await business();
      const lead = (
        await http.post('/leads', { fullName: 'Hina Raza', phone: '0301-5550000' }, b.token)
      ).body.data as Json;
      const q = (
        await http
          .post(
            '/quotations',
            { leadId: lead.id, lines: [{ variantId: variantId(b, 'SOFA-A'), quantity: '1' }] },
            b.token,
          )
          .expect(201)
      ).body.data as Json;
      expect(q.customerId).toBeNull();
      await toAccepted(b, q.id);
      const res = await http.post(`/quotations/${q.id}/convert`, {}, b.token).expect(200);
      expect(res.body.data.order.customerId).toBeTruthy();
      const leadAfter = (await http.get(`/leads/${lead.id}`, b.token)).body.data;
      expect(leadAfter.customerId).toBe(res.body.data.order.customerId);
    });
  });

  describe('lead conversion target QUOTATION (9.4)', () => {
    it('creates a draft pre-filled from the lead with its attachments', async () => {
      const b = await business();
      const lead = (
        await http
          .post(
            '/leads',
            {
              fullName: 'Hina Raza',
              phone: '0301-5550000',
              requirements: 'Three-seater in grey',
              interestedProductId: undefined,
            },
            b.token,
          )
          .expect(201)
      ).body.data as Json;
      await attach(b, 'LEAD', lead.id);
      const res = await http
        .post(`/leads/${lead.id}/convert`, { target: 'QUOTATION' }, b.token)
        .expect(200);
      const doc = res.body.data.document as Json;
      expect(doc.type).toBe('QUOTATION');
      expect(doc.number).toMatch(/^QT-/);
      const q = (await http.get(`/quotations/${doc.id}`, b.token).expect(200)).body.data as Json;
      expect(q.status).toBe('DRAFT');
      expect(q.leadId).toBe(lead.id);
      expect(q.customerId).toBe(res.body.data.customer.id);
      expect(q.notes).toBe('Three-seater in grey');
      const files = (await http.get(`/quotations/${doc.id}/attachments`, b.token).expect(200)).body
        .data as Json[];
      expect(files).toHaveLength(1);
      // the lead's own attachment is still there
      const leadFiles = (await http.get(`/leads/${lead.id}/attachments`, b.token)).body
        .data as Json[];
      expect(leadFiles).toHaveLength(1);
    });
  });

  describe('list, permissions and isolation', () => {
    it('lists newest first with filters and cursor paging', async () => {
      const b = await business();
      for (let i = 0; i < 3; i += 1) await create(b).expect(201);
      const first = (await http.get('/quotations?limit=2', b.token).expect(200)).body as Json;
      expect(first.data).toHaveLength(2);
      expect(first.meta.nextCursor).toBeTruthy();
      const second = (
        await http.get(`/quotations?limit=2&cursor=${first.meta.nextCursor}`, b.token).expect(200)
      ).body as Json;
      expect(second.data).toHaveLength(1);
      const sent = (await http.get('/quotations?status=SENT', b.token).expect(200)).body.data;
      expect(sent).toEqual([]);
      const byCustomer = (
        await http.get(`/quotations?customerId=${b.customer.id}`, b.token).expect(200)
      ).body.data;
      expect(byCustomer).toHaveLength(3);
    });

    it('enforces quotation permissions', async () => {
      const b = await business();
      const q = (await create(b).expect(201)).body.data as Json;
      const viewer = await member(b, 'Viewer');
      await http.get('/quotations', viewer).expect(200);
      await http.get(`/quotations/${q.id}`, viewer).expect(200);
      await http.post('/quotations', { customerId: b.customer.id, lines: [] }, viewer).expect(403);
      await http.post(`/quotations/${q.id}/send`, {}, viewer).expect(403);
      await http.post(`/quotations/${q.id}/convert`, {}, viewer).expect(403);
      await http.get('/quotations').expect(401);
    });

    it("another workspace cannot see, change or convert a quotation, or use another's customer", async () => {
      const a = await business();
      const other = await business();
      const q = (await create(a).expect(201)).body.data as Json;
      await http.get(`/quotations/${q.id}`, other.token).expect(404);
      await http.patch(`/quotations/${q.id}`, { version: 1, notes: 'x' }, other.token).expect(404);
      await http.post(`/quotations/${q.id}/send`, {}, other.token).expect(404);
      await http.post(`/quotations/${q.id}/convert`, {}, other.token).expect(404);
      await http.get(`/quotations/${q.id}/attachments`, other.token).expect(404);
      expect((await http.get('/quotations', other.token)).body.data).toEqual([]);
      await http
        .post('/quotations', { customerId: a.customer.id, lines: [] }, other.token)
        .expect((res) => expect([400, 404, 422]).toContain(res.status));
    });
  });
});
