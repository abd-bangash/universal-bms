import request from 'supertest';
import { DocumentRenderer } from '../src/modules/documents/document-renderer';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { renderInNode } from './helpers/render-pdf-node';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Suppliers and purchasing (real PostgreSQL)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;
  let keys = 0;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
    jest
      .spyOn(t.app.get(DocumentRenderer), 'render')
      .mockImplementation((type, snapshot, options) =>
        renderInNode({ ...snapshot, type }, options),
      );
  }, 90_000);
  afterAll(() => t.close());

  async function business() {
    const email = `owner${++n}@buy.test`;
    const created = await t.app.get(TenantsService).createWorkspace({
      name: `Buy ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      country: 'PK',
    });
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const roles = (await http.get('/roles', token)).body.data as Json[];
    const chair = (
      await http
        .post(
          '/catalog/products',
          {
            code: 'CH',
            name: 'Chair',
            basePrice: '100',
            costPrice: '40',
            variants: [{ sku: 'CH-A' }],
          },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const table = (
      await http
        .post(
          '/catalog/products',
          { code: 'TB', name: 'Table', basePrice: '300', variants: [{ sku: 'TB-A' }] },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const service = (
      await http
        .post(
          '/catalog/products',
          {
            type: 'NON_STOCKABLE',
            code: 'SV',
            name: 'Assembly',
            basePrice: '10',
            variants: [{ sku: 'SV-A' }],
          },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const supplier = (
      await http.post('/suppliers', { name: 'Timber Co', phone: '0300-1' }, token).expect(201)
    ).body.data as Json;
    return {
      ...created,
      token,
      roles,
      chair: chair.variants[0].id as string,
      table: table.variants[0].id as string,
      service: service.variants[0].id as string,
      supplier: supplier.id as string,
    };
  }
  type Biz = Awaited<ReturnType<typeof business>>;

  async function member(b: Biz, roleName: string) {
    const email = `${roleName.toLowerCase().replace(/\W/g, '')}${++n}@buy.test`;
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
    return { token };
  }

  const post = (who: { token: string }, path: string, body: object = {}, key?: string) => {
    const req = request(t.app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${who.token}`)
      .set('X-Forwarded-For', `10.66.${(++n >> 8) & 255}.${n & 255}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const newPo = async (b: Biz, lines: object[], extra: object = {}) =>
    (await post(b, '/purchases', { supplierId: b.supplier, lines, ...extra }).expect(201)).body
      .data as Json;
  const send = (b: { token: string }, id: string) =>
    post(b, `/purchases/${id}/status`, { status: 'sent' }).expect(200);
  const receive = (b: { token: string }, id: string, lines: object[], key = `r-${++keys}`) =>
    post(b, `/purchases/${id}/receive`, { lines }, key);
  const level = async (b: Biz, variantId: string) => {
    const l = await t.db.prisma.stockLevel.findFirst({
      where: { workspaceId: b.workspaceId, variantId },
    });
    return { onHand: l?.onHand.toFixed() ?? '0', avgCost: l?.avgCost.toFixed() ?? '0' };
  };

  describe('suppliers', () => {
    it('creates, edits, searches, archives and restores; names are unique (7.8)', async () => {
      const b = await business();
      await http.post('/suppliers', { name: 'timber co' }, b.token).expect(422);
      const edited = (
        await http
          .patch(
            `/suppliers/${b.supplier}`,
            { contactName: 'Tariq', email: 'T@Timber.test' },
            b.token,
          )
          .expect(200)
      ).body.data as Json;
      expect(edited).toMatchObject({ contactName: 'Tariq', email: 't@timber.test' });
      expect(((await http.get('/suppliers?q=timb', b.token)).body.data as Json[]).length).toBe(1);
      await post(b, `/suppliers/${b.supplier}/archive`).expect(200);
      expect(((await http.get('/suppliers', b.token)).body.data as Json[]).length).toBe(0);
      expect(
        ((await http.get('/suppliers?status=ARCHIVED', b.token)).body.data as Json[]).length,
      ).toBe(1);
      await http.patch(`/suppliers/${b.supplier}`, { notes: 'x' }, b.token).expect(422);
      await post(b, `/suppliers/${b.supplier}/restore`).expect(200);
      expect(
        await t.db.prisma.auditEvent.count({
          where: { workspaceId: b.workspaceId, action: { startsWith: 'supplier.' } },
        }),
      ).toBeGreaterThanOrEqual(4);
    });

    it('suppliers are found by the global search by name or contact (31.1)', async () => {
      const b = await business();
      const other = await business();
      await http
        .patch(`/suppliers/${b.supplier}`, { contactName: 'Tariq Mehmood' }, b.token)
        .expect(200);
      for (const q of ['timber', 'tariq']) {
        const groups = (await http.get(`/search?q=${q}`, b.token)).body.data.groups as Json[];
        expect(groups.find((g) => g.type === 'SUPPLIER')?.hits[0]).toMatchObject({
          title: 'Timber Co',
          href: `/purchasing/suppliers/${b.supplier}`,
        });
      }
      const none = (await http.get('/search?q=timber', other.token)).body.data.groups as Json[];
      expect(none.find((g) => g.type === 'SUPPLIER')?.hits.map((h: Json) => h.id)).toEqual([
        other.supplier,
      ]);
    });

    it('an archived supplier cannot receive new orders', async () => {
      const b = await business();
      await post(b, `/suppliers/${b.supplier}/archive`).expect(200);
      await post(b, '/purchases', {
        supplierId: b.supplier,
        lines: [{ variantId: b.chair, quantity: '1' }],
      }).expect(400);
    });

    it('is permission-gated and tenant-isolated', async () => {
      const a = await business();
      const other = await business();
      const viewer = await member(a, 'Viewer');
      await http.get('/suppliers', viewer.token).expect(200); // view-only
      await post(viewer, '/suppliers', { name: 'Nope' }).expect(403);
      await http.get(`/suppliers/${a.supplier}`, other.token).expect(404);
      await http.patch(`/suppliers/${a.supplier}`, { notes: 'x' }, other.token).expect(404);
      await post(other, '/purchases', {
        supplierId: a.supplier,
        lines: [{ variantId: other.chair, quantity: '1' }],
      }).expect(400);
      const staff = await member(a, 'Inventory Staff');
      await http.get('/suppliers', staff.token).expect(200);
    });
  });

  describe('purchase orders', () => {
    it('creates a draft with costs from the product, totals and a number (7.8)', async () => {
      const b = await business();
      const po = await newPo(b, [
        { variantId: b.chair, quantity: '10' },
        { variantId: b.table, quantity: '2', unitCost: '150.50' },
      ]);
      expect(po).toMatchObject({
        status: 'draft',
        subtotal: '701',
        totalAmount: '701',
        supplierName: 'Timber Co',
      });
      expect(po.orderNumber).toMatch(/^PO-/);
      expect(po.items.map((i: Json) => [i.sku, i.unitCost, i.lineTotal])).toEqual([
        ['CH-A', '40', '400'],
        ['TB-A', '150.5', '301'],
      ]);
    });

    it('a variant with no cost price needs a cost; services cannot be bought', async () => {
      const b = await business();
      await post(b, '/purchases', {
        supplierId: b.supplier,
        lines: [{ variantId: b.table, quantity: '1' }],
      }).expect(400);
      await post(b, '/purchases', {
        supplierId: b.supplier,
        lines: [{ variantId: b.service, quantity: '1', unitCost: '5' }],
      }).expect(400);
      await post(b, '/purchases', {
        supplierId: b.supplier,
        lines: [{ variantId: b.chair, quantity: '0' }],
      }).expect(400);
    });

    it('edits a draft, rejects stale versions, and locks lines once sent', async () => {
      const b = await business();
      const po = await newPo(b, [{ variantId: b.chair, quantity: '10' }]);
      const edited = (
        await http
          .patch(
            `/purchases/${po.id}`,
            {
              version: po.version,
              lines: [{ variantId: b.chair, quantity: '5' }],
              taxAmount: '10',
            },
            b.token,
          )
          .expect(200)
      ).body.data as Json;
      expect(edited).toMatchObject({ subtotal: '200', taxAmount: '10', totalAmount: '210' });
      const stale = await http
        .patch(`/purchases/${po.id}`, { version: po.version, notes: 'late' }, b.token)
        .expect(409);
      expect(stale.body.code).toBe('STALE_VERSION');
      await send(b, po.id);
      await http
        .patch(
          `/purchases/${po.id}`,
          { version: edited.version + 1, lines: [{ variantId: b.chair, quantity: '1' }] },
          b.token,
        )
        .expect(422);
      await http
        .patch(
          `/purchases/${po.id}`,
          { version: edited.version + 1, expectedDate: '2030-01-01', notes: 'call first' },
          b.token,
        )
        .expect(200);
    });

    it('moves through the workflow; received states cannot be set by hand (27.3)', async () => {
      const b = await business();
      const po = await newPo(b, [{ variantId: b.chair, quantity: '10' }]);
      expect(
        (await http.get(`/purchases/${po.id}`, b.token)).body.data.allowedTransitions.map(
          (a: Json) => a.to,
        ),
      ).toEqual(expect.arrayContaining(['sent', 'cancelled']));
      expect(
        (await http.get(`/purchases/${po.id}`, b.token)).body.data.allowedTransitions.map(
          (a: Json) => a.to,
        ),
      ).not.toContain('received');
      const res = await post(b, `/purchases/${po.id}/status`, { status: 'received' }).expect(422);
      expect(res.body.message).toMatch(/receiving the goods/);
      await post(b, `/purchases/${po.id}/status`, { status: 'partially_received' }).expect(422);
      const sent = (await send(b, po.id)).body.data;
      expect(sent.purchase.status).toBe('sent');
    });

    it('cannot send an order without lines or cancel one that has been received', async () => {
      const b = await business();
      const po = await newPo(b, [{ variantId: b.chair, quantity: '2' }]);
      await send(b, po.id);
      const item = (await http.get(`/purchases/${po.id}`, b.token)).body.data.items[0];
      await receive(b, po.id, [{ itemId: item.id, quantity: '1' }]).expect(201);
      // the workflow offers no way out of Partially received, and the rule backs it up
      await post(b, `/purchases/${po.id}/status`, { status: 'cancelled' }).expect(422);
      expect((await http.get(`/purchases/${po.id}`, b.token)).body.data.status).toBe(
        'partially_received',
      );
      const draft = await newPo(b, [{ variantId: b.chair, quantity: '1' }]);
      await post(b, `/purchases/${draft.id}/status`, { status: 'cancelled' }).expect(200);
    });
  });

  describe('56.1 receiving goods', () => {
    it('partial then final receipt sets Partially received then Received, posting stock and weighted cost (7.9, 37.7)', async () => {
      const b = await business();
      // 10 on hand at 40 to start with
      await post(
        b,
        '/inventory/opening-stock',
        {
          lines: [{ variantId: b.chair, quantity: '10', unitCost: '40' }],
        },
        `o-${++keys}`,
      ).expect(201);
      const po = await newPo(b, [{ variantId: b.chair, quantity: '10', unitCost: '60' }]);
      await send(b, po.id);
      const item = po.items[0];

      const first = (await receive(b, po.id, [{ itemId: item.id, quantity: '4' }]).expect(201)).body
        .data as Json;
      expect(first.purchase.status).toBe('partially_received');
      expect(first.receipt.receiptNumber).toMatch(/^GRN-/);
      expect(first.purchase.items[0].receivedQty).toBe('4');
      expect(await level(b, b.chair)).toEqual({ onHand: '14', avgCost: '45.7143' }); // (10×40 + 4×60) / 14

      const second = (await receive(b, po.id, [{ itemId: item.id, quantity: '6' }]).expect(201))
        .body.data as Json;
      expect(second.purchase.status).toBe('received');
      expect(await level(b, b.chair)).toEqual({ onHand: '20', avgCost: '50' }); // (10×40 + 10×60) / 20
      const movements = await t.db.prisma.stockMovement.findMany({
        where: { workspaceId: b.workspaceId, movementType: 'PURCHASE_RECEIPT' },
        orderBy: { createdAt: 'asc' },
      });
      expect(movements.map((m) => m.quantityDelta.toFixed())).toEqual(['4', '6']);
      expect(movements[0]).toMatchObject({ referenceType: 'PURCHASE', referenceId: po.id });
      expect(movements.every((m) => m.unitCost?.toFixed() === '60')).toBe(true);
      const history = await t.db.prisma.statusHistory.findMany({
        where: { entityId: po.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(history.map((h) => h.toKey)).toEqual(['sent', 'partially_received', 'received']);
      expect(await t.db.prisma.goodsReceipt.count({ where: { purchaseOrderId: po.id } })).toBe(2);
      await receive(b, po.id, [{ itemId: item.id, quantity: '1' }]).expect(422);
    });

    it('a different unit cost on arrival is what the average uses', async () => {
      const b = await business();
      const po = await newPo(b, [{ variantId: b.chair, quantity: '10', unitCost: '60' }]);
      await send(b, po.id);
      await receive(b, po.id, [{ itemId: po.items[0].id, quantity: '10', unitCost: '70' }]).expect(
        201,
      );
      expect(await level(b, b.chair)).toEqual({ onHand: '10', avgCost: '70' });
    });

    it('rejects over-receipt unless the person may approve; bad lines change nothing (7.9)', async () => {
      const b = await business();
      const po = await newPo(b, [
        { variantId: b.chair, quantity: '5' },
        { variantId: b.table, quantity: '5', unitCost: '90' },
      ]);
      await send(b, po.id);
      const [chairItem, tableItem] = po.items;
      const staff = await member(b, 'Inventory Staff');
      const res = await post(
        staff,
        `/purchases/${po.id}/receive`,
        { lines: [{ itemId: chairItem.id, quantity: '6' }] },
        `s-${++keys}`,
      ).expect(422);
      expect(res.body.details['lines[0].quantity']).toBeDefined();
      // a valid line next to a bad one: nothing is received
      await receive(b, po.id, [
        { itemId: tableItem.id, quantity: '1' },
        { itemId: 'nope', quantity: '1' },
      ]).expect(400);
      await receive(b, po.id, [{ itemId: chairItem.id, quantity: '0' }]).expect(400);
      await receive(b, po.id, [
        { itemId: chairItem.id, quantity: '1' },
        { itemId: chairItem.id, quantity: '1' },
      ]).expect(400);
      expect(await t.db.prisma.stockMovement.count({ where: { workspaceId: b.workspaceId } })).toBe(
        0,
      );
      expect(await t.db.prisma.goodsReceipt.count({ where: { workspaceId: b.workspaceId } })).toBe(
        0,
      );
      // the owner (purchase:approve) may take in more than was ordered
      const over = (await receive(b, po.id, [{ itemId: chairItem.id, quantity: '6' }]).expect(201))
        .body.data as Json;
      expect(over.purchase.items[0].receivedQty).toBe('6');
      expect(over.purchase.status).toBe('partially_received'); // the table has not arrived
    });

    it('draft and cancelled orders cannot be received', async () => {
      const b = await business();
      const po = await newPo(b, [{ variantId: b.chair, quantity: '5' }]);
      await receive(b, po.id, [{ itemId: po.items[0].id, quantity: '1' }]).expect(422);
      await post(b, `/purchases/${po.id}/status`, { status: 'cancelled' }).expect(200);
      await receive(b, po.id, [{ itemId: po.items[0].id, quantity: '1' }]).expect(422);
    });

    it('converts the purchase unit to the base unit and keeps the cost per base unit', async () => {
      const b = await business();
      const carton = (
        await http
          .post(
            '/catalog/products',
            {
              code: 'BOLT',
              name: 'Bolts',
              basePrice: '1',
              purchaseUnitFactor: '12',
              costPrice: '120',
              variants: [{ sku: 'BOLT-A' }],
            },
            b.token,
          )
          .expect(201)
      ).body.data as Json;
      const variantId = carton.variants[0].id as string;
      const po = await newPo(b, [{ variantId, quantity: '2' }]); // 2 cartons at 120
      await send(b, po.id);
      await receive(b, po.id, [{ itemId: po.items[0].id, quantity: '2' }]).expect(201);
      expect(await level(b, variantId)).toEqual({ onHand: '24', avgCost: '10' });
    });

    it('the same idempotency key receives once, concurrently or not (54.1)', async () => {
      const b = await business();
      const po = await newPo(b, [{ variantId: b.chair, quantity: '10' }]);
      await send(b, po.id);
      const key = `same-${++keys}`;
      const body = [{ itemId: po.items[0].id, quantity: '3' }];
      const results = await Promise.all([
        receive(b, po.id, body, key),
        receive(b, po.id, body, key),
        receive(b, po.id, body, key),
      ]);
      expect(results.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
      await receive(b, po.id, body, key).expect(201);
      expect(await level(b, b.chair)).toEqual({ onHand: '3', avgCost: '40' });
      expect(await t.db.prisma.goodsReceipt.count({ where: { purchaseOrderId: po.id } })).toBe(1);
      await post(b, `/purchases/${po.id}/receive`, { lines: body }).expect(400); // the key is required
    });

    it('needs purchase:receive; another workspace cannot receive it', async () => {
      const a = await business();
      const other = await business();
      const po = await newPo(a, [{ variantId: a.chair, quantity: '2' }]);
      await send(a, po.id);
      const viewer = await member(a, 'Viewer');
      await receive(viewer, po.id, [{ itemId: po.items[0].id, quantity: '1' }]).expect(403);
      await receive(other, po.id, [{ itemId: po.items[0].id, quantity: '1' }]).expect(404);
      await http.get(`/purchases/${po.id}`, other.token).expect(404);
    });
  });

  describe('quick purchase', () => {
    it('creates and fully receives in one step', async () => {
      const b = await business();
      const res = (
        await post(
          b,
          '/purchases/quick',
          {
            supplierId: b.supplier,
            lines: [{ variantId: b.chair, quantity: '8', unitCost: '45' }],
          },
          `q-${++keys}`,
        ).expect(201)
      ).body.data as Json;
      expect(res.purchase).toMatchObject({ status: 'received', totalAmount: '360' });
      expect(res.purchase.items[0]).toMatchObject({ quantity: '8', receivedQty: '8' });
      expect(res.receipt.receiptNumber).toMatch(/^GRN-/);
      expect(await level(b, b.chair)).toEqual({ onHand: '8', avgCost: '45' });
      const supplier = (await http.get(`/suppliers/${b.supplier}`, b.token)).body.data as Json;
      expect(supplier.summary).toEqual({
        totalOrdered: '360',
        totalReceived: '360',
        totalReturned: '0',
        totalPaid: '0',
        balance: '360',
      });
      const history = (await http.get(`/suppliers/${b.supplier}/purchases`, b.token)).body
        .data as Json[];
      expect(history.map((h) => h.id)).toEqual([res.purchase.id]);
    });

    it('a failure while posting stock leaves no order, receipt or movement', async () => {
      const b = await business();
      const failing = jest
        .spyOn(InventoryService.prototype, 'post')
        .mockRejectedValue(new Error('injected'));
      const res = await post(
        b,
        '/purchases/quick',
        { supplierId: b.supplier, lines: [{ variantId: b.chair, quantity: '8' }] },
        `q-${++keys}`,
      );
      expect(res.status).toBe(500);
      failing.mockRestore();
      expect(await t.db.prisma.purchaseOrder.count({ where: { workspaceId: b.workspaceId } })).toBe(
        0,
      );
      expect(await t.db.prisma.goodsReceipt.count({ where: { workspaceId: b.workspaceId } })).toBe(
        0,
      );
      expect(await t.db.prisma.stockMovement.count({ where: { workspaceId: b.workspaceId } })).toBe(
        0,
      );
    });

    it('needs both create and receive permissions', async () => {
      const b = await business();
      const viewer = await member(b, 'Viewer');
      await post(
        viewer,
        '/purchases/quick',
        { supplierId: b.supplier, lines: [] },
        `q-${++keys}`,
      ).expect(403);
    });
  });

  describe('purchase order PDF (29.1)', () => {
    it('draws the order for the supplier', async () => {
      const b = await business();
      const po = await newPo(b, [{ variantId: b.chair, quantity: '10' }], {
        expectedDate: '2030-05-01',
      });
      const res = await request(t.app.getHttpServer())
        .get(`/api/v1/purchases/${po.id}/pdf`)
        .set('Authorization', `Bearer ${b.token}`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/);
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect(res.headers['content-disposition']).toContain(po.orderNumber);
    });
  });
});
