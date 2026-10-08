import request from 'supertest';
import { textOf } from '../src/modules/documents/document-layout';
import { DocumentRenderer } from '../src/modules/documents/document-renderer';
import type { ReceiptData } from '../src/modules/documents/document.types';
import { buildReceipt, PAPERS } from '../src/modules/documents/receipt-layout';
import { SettingsService } from '../src/modules/settings/settings.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { runWithWorkspace } from './helpers/context';
import { renderReceiptInNode } from './helpers/render-pdf-node';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Receipt PDFs (real PostgreSQL)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;
  let keys = 0;
  let renders: Array<{ paper: string; reprint?: boolean }> = [];

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
    const renderer = t.app.get(DocumentRenderer);
    jest.spyOn(renderer, 'renderReceipt').mockImplementation((data, options) => {
      renders.push({ paper: options.paper, reprint: options.reprint });
      return renderReceiptInNode(data, options);
    });
  }, 90_000);
  afterAll(() => t.close());

  async function sold() {
    const email = `owner${++n}@rpdf.test`;
    const created = await t.app.get(TenantsService).createWorkspace({
      name: `Rpdf ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      country: 'PK',
    });
    await runWithWorkspace(t.app, created.workspaceId, () =>
      t.app.get(SettingsService).update({
        business: { legalName: 'Acme Furniture Co' },
        documents: { receiptFooter: 'Thank you, come again' },
      }),
    );
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const product = (
      await http
        .post(
          '/catalog/products',
          { code: 'CH', name: 'Chair', basePrice: '100.00', variants: [{ sku: 'CH-A' }] },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const variantId = product.variants[0].id as string;
    const post = (path: string, body: object, key?: string) => {
      const req = request(t.app.getHttpServer())
        .post(`/api/v1${path}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', `10.88.${(++n >> 8) & 255}.${n & 255}`);
      if (key) req.set('Idempotency-Key', key);
      return req.send(body);
    };
    await post(
      '/inventory/opening-stock',
      { lines: [{ variantId, quantity: '10', unitCost: '40' }] },
      `o-${++keys}`,
    ).expect(201);
    const methods = (await http.get('/settings/payment-methods', token)).body.data as Json[];
    const cash = methods.find((m) => m.name === 'Cash')?.id as string;
    const res = await post(
      '/pos/checkout',
      {
        lines: [{ variantId, quantity: '2' }],
        payment: { paymentMethodId: cash, tendered: '500' },
      },
      `s-${++keys}`,
    ).expect(201);
    return {
      token,
      post,
      workspaceId: created.workspaceId,
      receipt: res.body.data.receipt as Json,
    };
  }

  const pdf = (token: string, id: string, query = '') =>
    request(t.app.getHttpServer())
      .get(`/api/v1/documents/receipts/${id}/pdf${query}`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  it.each(['58mm', '80mm', 'A4'])('draws a %s receipt as a PDF', async (paper) => {
    const s = await sold();
    const res = await pdf(s.token, s.receipt.id, `?paper=${paper}`).expect(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toContain(`${s.receipt.receiptNumber}.pdf`);
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(body.toString('latin1'));
    expect(Number(box?.[1])).toBeCloseTo(PAPERS[paper as keyof typeof PAPERS].width, 0);
  });

  it("uses the workspace's configured paper when none is asked for, and rejects an unknown one", async () => {
    const s = await sold();
    renders = [];
    await pdf(s.token, s.receipt.id).expect(200);
    expect(renders[0]!.paper).toBe('80mm');
    await runWithWorkspace(t.app, s.workspaceId, () =>
      t.app.get(SettingsService).update({ documents: { receiptPaper: '58mm' } }),
    );
    await pdf(s.token, s.receipt.id).expect(200);
    expect(renders[1]!.paper).toBe('58mm');
    await pdf(s.token, s.receipt.id, '?paper=A3').expect(400);
  });

  it('carries every field of Requirement 12.5 and the footer', async () => {
    const s = await sold();
    const stored = (await http.get(`/pos/receipts/${s.receipt.id}`, s.token)).body.data;
    const content = textOf(
      buildReceipt(stored.data as ReceiptData, {
        paper: '80mm',
        receiptNumber: stored.receiptNumber,
      }),
    );
    for (const part of [
      'Acme Furniture Co',
      stored.receiptNumber,
      stored.data.transactionNumber,
      'Cashier',
      'Chair',
      'Subtotal',
      'Total',
      'Cash',
      'Tendered',
      'Change',
      'Thank you, come again',
    ]) {
      expect(content).toContain(part);
    }
    expect(content).not.toContain('REPRINT');
  });

  it('marks copies after the first print as REPRINT (29.8)', async () => {
    const s = await sold();
    renders = [];
    await pdf(s.token, s.receipt.id).expect(200);
    expect(renders[0]!.reprint).toBe(false);
    await s.post(`/pos/receipts/${s.receipt.id}/reprint`, {}).expect(200);
    await pdf(s.token, s.receipt.id).expect(200);
    expect(renders[1]!.reprint).toBe(true);
    const stored = (await http.get(`/pos/receipts/${s.receipt.id}`, s.token)).body.data;
    const marked = textOf(
      buildReceipt(stored.data, { paper: '58mm', receiptNumber: 'X', reprint: true }),
    );
    expect(marked).toContain('REPRINT');
  });

  it('is permission-gated and tenant-isolated', async () => {
    const a = await sold();
    const b = await sold();
    await pdf(b.token, a.receipt.id).expect(404);
    await request(t.app.getHttpServer())
      .get(`/api/v1/documents/receipts/${a.receipt.id}/pdf`)
      .expect(401);
  });
});
