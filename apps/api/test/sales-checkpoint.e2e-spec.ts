import request from 'supertest';
import { DocumentRenderer } from '../src/modules/documents/document-renderer';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { renderInNode } from './helpers/render-pdf-node';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

/** Checkpoint 38: from an enquiry to a confirmed order with its documents, through the HTTP API. */
describe('Checkpoint — quotations and orders', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;

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

  it('lead → quotation with a custom sofa line → acceptance recorded → order → confirmed; the PDFs open', async () => {
    const email = 'owner@sales-checkpoint.test';
    await t.app.get(TenantsService).createWorkspace({
      name: 'Sales Checkpoint',
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      country: 'PK',
    });
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;

    // 1. an enquiry for a custom sofa
    const lead = (
      await http
        .post(
          '/leads',
          {
            fullName: 'Checkpoint Hina',
            phone: '0300-4440002',
            interest: 'Custom corner sofa',
            requirements: 'Grey, 9ft by 6ft',
            estimatedValue: '165000',
            source: 'SOCIAL',
          },
          token,
        )
        .expect(201)
    ).body.data as Json;

    // 2. a quotation with a custom sofa line carrying its measurements
    const quotation = (
      await http
        .post(
          '/quotations',
          {
            leadId: lead.id,
            lines: [
              {
                kind: 'CUSTOM',
                name: 'Custom corner sofa',
                quantity: '1',
                unitPrice: '165000',
                customFields: {
                  size_type: 'custom',
                  length: { value: '9', unit: 'ft' },
                  width: { value: '6', unit: 'ft' },
                  material: 'fabric',
                  color: 'Grey',
                },
              },
            ],
            notes: 'Delivery within 5 weeks',
          },
          token,
        )
        .expect(201)
    ).body.data as Json;
    expect(quotation.status).toBe('DRAFT');
    expect(quotation.items[0].fieldSnapshot.map((f: Json) => f.label)).toEqual(
      expect.arrayContaining(['Length', 'Width', 'Colour']),
    );

    // 3. sent to the customer, then the customer says yes by phone: who, when, how
    await http.post(`/quotations/${quotation.id}/send`, {}, token).expect(200);
    const accepted = (
      await http.post(`/quotations/${quotation.id}/accept`, { via: 'PHONE' }, token).expect(200)
    ).body.data as Json;
    expect(accepted).toMatchObject({ status: 'ACCEPTED', acceptedVia: 'PHONE' });
    expect(accepted.acceptanceRecordedById).toBeTruthy();

    // 4. the accepted quotation becomes an order with the same lines, prices and measurements
    const converted = (
      await http.post(`/quotations/${quotation.id}/convert`, {}, token).expect(200)
    ).body.data as Json;
    const order = converted.order as Json;
    expect(converted.quotation.status).toBe('CONVERTED');
    expect(order.totalAmount).toBe(quotation.totalAmount);
    expect(order.items[0].fieldSnapshot).toEqual(quotation.items[0].fieldSnapshot);
    expect(order.status).toBe('draft');

    // the enquiry became a customer
    const customerId = order.customerId as string;
    expect((await http.get(`/leads/${lead.id}`, token)).body.data.customerId).toBe(customerId);

    // 5. confirmed: the deposit is fixed and the lead is won
    const confirmed = (
      await http.post(`/orders/${order.id}/status`, { status: 'confirmed' }, token).expect(200)
    ).body.data.order as Json;
    expect(confirmed.status).toBe('confirmed');
    expect((await http.get(`/leads/${lead.id}`, token)).body.data.stage).toBe('won');
    const timeline = (await http.get(`/orders/${order.id}/timeline`, token).expect(200)).body
      .data as Json[];
    expect(timeline.map((e) => e.summary).join('|')).toMatch(/created from quotation/);

    // 6. an invoice, and every document opens as a PDF
    const invoice = (await http.post(`/orders/${order.id}/invoice`, {}, token).expect(201)).body
      .data as Json;
    for (const path of [
      `/quotations/${quotation.id}/pdf`,
      `/orders/${order.id}/pdf`,
      `/invoices/${invoice.id}/pdf`,
    ]) {
      const res = await request(t.app.getHttpServer())
        .get(`/api/v1${path}`)
        .set('Authorization', `Bearer ${token}`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    }
  });
});
