import { buildDocument, textOf } from '../document-layout';
import { renderInNode } from '../../../../test/helpers/render-pdf-node';
import type { DocumentSnapshot } from '../document.types';
import { formatAddress, formatDate, formatMoney, formatQuantity } from '../format';

const snapshot = (overrides: Partial<DocumentSnapshot> = {}): DocumentSnapshot => ({
  type: 'INVOICE',
  number: 'INV-2026-0007',
  issuedAt: '2026-03-04T21:30:00.000Z',
  business: {
    legalName: 'Acme Furniture',
    phone: '+92 300 0000000',
    email: 'hello@acme.test',
    address: '1 Mall Road\nLahore',
    taxNumber: 'NTN-123',
  },
  customer: {
    name: 'Sana Malik',
    phone: '+923001234567',
    email: 'sana@example.com',
    address: { line1: '12 Garden Road', city: 'Lahore', country: 'Pakistan' },
  },
  currency: { code: 'PKR', decimals: 2 },
  locale: { language: 'en', dateFormat: 'D MMM YYYY', timezone: 'Asia/Karachi' },
  labels: { document: 'Tax invoice', customer: 'Client' },
  pricesIncludeTax: false,
  orderNumber: 'ORD-2026-0003',
  lines: [
    {
      id: 'l1',
      lineNo: 1,
      kind: 'CUSTOM',
      productId: null,
      variantId: null,
      name: 'Corner sofa',
      sku: 'SOFA-01',
      description: 'Grey velvet',
      quantity: '2',
      unitId: null,
      listPrice: '145000',
      unitPrice: '145000',
      discountType: null,
      discountValue: '0',
      discountAmount: '0',
      taxClassId: null,
      taxRate: '0.15',
      taxAmount: '43500',
      lineTotal: '333500',
      customFields: {},
      fieldSnapshot: [
        { key: 'length', label: 'Length', value: '240', unit: 'cm' },
        { key: 'finish', label: 'Finish', value: 'Matte', unit: null },
      ],
    },
  ],
  totals: {
    subtotal: '290000',
    discountAmount: '0',
    taxAmount: '43500',
    roundingAmount: '0',
    totalAmount: '333500',
  },
  discount: { type: null, value: '0' },
  taxBreakdown: [{ rate: '15', taxable: '290000', tax: '43500' }],
  payments: [{ date: '2026-03-01T10:00:00.000Z', method: 'Bank transfer', amount: '100000' }],
  paidAmount: '100000',
  balanceDue: '233500',
  notes: 'Delivery on Friday',
  terms: 'Goods remain ours until paid in full.',
  bankDetails: { Bank: 'HBL', 'Account no.': '0011223344' },
  ...overrides,
});

describe('document formatting (29.7)', () => {
  it('formats money in the workspace currency and decimals', () => {
    expect(formatMoney('1234567.5', { code: 'USD', decimals: 2 })).toBe('$1,234,567.50');
    expect(formatMoney('1500', { code: 'JPY', decimals: 0 })).toMatch(/1,500/);
    expect(formatMoney('0.1', { code: 'USD', decimals: 4 })).toBe('$0.1000');
  });

  it('formats dates in the workspace timezone and format', () => {
    const at = '2026-03-04T21:30:00.000Z'; // already the 5th in Karachi
    expect(formatDate(at, 'DD/MM/YYYY', 'Asia/Karachi')).toBe('05/03/2026');
    expect(formatDate(at, 'DD/MM/YYYY', 'UTC')).toBe('04/03/2026');
    expect(formatDate(at, 'MM/DD/YYYY', 'UTC')).toBe('03/04/2026');
    expect(formatDate(at, 'YYYY-MM-DD', 'UTC')).toBe('2026-03-04');
    expect(formatDate(at, 'D MMM YYYY', 'Asia/Karachi')).toBe('5 Mar 2026');
  });

  it('formats quantities and addresses', () => {
    expect(formatQuantity('2.5000')).toBe('2.5');
    expect(formatQuantity('1200')).toBe('1,200');
    expect(formatAddress({ line1: 'A', city: 'B', state: 'C', country: 'D' })).toEqual([
      'A',
      'B, C',
      'D',
    ]);
    expect(formatAddress('x\ny')).toEqual(['x', 'y']);
    expect(formatAddress(null)).toEqual([]);
  });
});

describe('document content (29.4, 29.5, 29.7)', () => {
  const text = (s: DocumentSnapshot) => textOf(buildDocument(s));

  it('rendering the same snapshot twice produces the same text content (36.1)', () => {
    const s = snapshot();
    expect(text(s)).toBe(text(structuredClone(s)));
  });

  it('shows what an invoice must carry', () => {
    const out = text(snapshot());
    for (const expected of [
      'Tax invoice', // workspace terminology
      'INV-2026-0007',
      '5 Mar 2026', // workspace date format and timezone
      'Acme Furniture',
      'NTN-123',
      'Client',
      'Sana Malik',
      '12 Garden Road',
      'Corner sofa',
      'SOFA-01',
      'Length: 240 cm', // custom field snapshot
      'Finish: Matte',
      'Tax 15%',
      'Total paid',
      'Balance due',
      'Bank transfer',
      'Bank details',
      'HBL',
      'Goods remain ours until paid in full.',
      'Delivery on Friday',
      'ORD-2026-0003',
    ]) {
      expect(out).toContain(expected);
    }
    expect(out).toMatch(/PKR|₨|Rs/);
  });

  it('leaves out what is absent and keeps old snapshots renderable', () => {
    const old = snapshot({
      type: 'QUOTATION',
      labels: undefined,
      locale: undefined,
      taxBreakdown: undefined,
      payments: undefined,
      paidAmount: undefined,
      balanceDue: undefined,
      bankDetails: null,
      terms: null,
      notes: null,
      validUntil: '2026-04-01T00:00:00.000Z',
    });
    const out = text(old);
    expect(out).toContain('Quotation');
    expect(out).toContain('Customer');
    expect(out).toContain('Valid until: 01/04/2026');
    expect(out).not.toContain('Balance due');
    expect(out).not.toContain('Bank details');
    expect(out).not.toContain('Notes');
  });

  it('addresses a quotation to a lead that is not yet a customer', () => {
    const out = text(
      snapshot({
        type: 'QUOTATION',
        customer: null,
        contact: { name: 'Hina Raza', phone: '0301', email: null },
      }),
    );
    expect(out).toContain('Hina Raza');
  });
});

describe('PDF output', () => {
  it('produces a PDF', async () => {
    const buffer = await renderInNode(snapshot());
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.subarray(-6).toString()).toContain('%%EOF');
    expect(buffer.length).toBeGreaterThan(1000);
  }, 30_000);

  it('renders every document kind, and many lines across pages', async () => {
    const base = snapshot();
    const line = base.lines[0]!;
    const many = snapshot({
      lines: Array.from({ length: 60 }, (_, i) => ({ ...line, id: `l${i}`, lineNo: i + 1 })),
    });
    for (const type of ['QUOTATION', 'ORDER_CONFIRMATION', 'INVOICE'] as const) {
      const buffer = await renderInNode({ ...many, type });
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
      expect((buffer.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
    }
  }, 60_000);
});
