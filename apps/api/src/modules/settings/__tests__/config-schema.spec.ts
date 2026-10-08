import { DEFAULT_MODULES, DEFAULT_TERMINOLOGY } from '@bms/types';
import { workspaceConfigSchema, zodIssuesToDetails } from '@bms/validators';
import { createDefaultConfig } from '../../tenants/default-config';
import { flatten } from '../settings.service';

describe('WorkspaceConfigSchema', () => {
  const defaults = workspaceConfigSchema.parse({});

  it('has a default for every section, agreeing with the shared constants', () => {
    expect(Object.keys(defaults).sort()).toEqual(
      [
        'ai',
        'branding',
        'business',
        'commission',
        'documents',
        'duplicates',
        'inventory',
        'locale',
        'messaging',
        'modules',
        'numbering',
        'pos',
        'retention',
        'sales',
        'tax',
        'terminology',
      ].sort(),
    );
    expect(defaults.terminology).toEqual(DEFAULT_TERMINOLOGY);
    expect(defaults.modules).toEqual(DEFAULT_MODULES);
    expect(Object.keys(defaults.numbering)).toHaveLength(9);
  });

  it('is idempotent: validating a validated config changes nothing', () => {
    expect(workspaceConfigSchema.parse(defaults)).toEqual(defaults);
    const created = createDefaultConfig({
      legalName: 'Acme',
      currency: 'PKR',
      timezone: 'Asia/Karachi',
    });
    expect(workspaceConfigSchema.parse(created)).toEqual(created);
    expect(created.locale).toMatchObject({ currency: 'PKR', timezone: 'Asia/Karachi' });
  });

  it('fills missing keys inside a partial section', () => {
    const parsed = workspaceConfigSchema.parse({
      sales: { requiredDepositPercent: 30 },
      numbering: { QUOTATION: { prefix: 'Q-', includeYear: false, padding: 3 } },
    });
    expect(parsed.sales).toEqual({
      requiredDepositPercent: 30,
      discountOverLimit: 'REJECT',
      cashRoundingIncrement: null,
      leadDedupWindowHours: 24,
    });
    expect(parsed.numbering.QUOTATION.prefix).toBe('Q-');
    expect(parsed.numbering.ORDER.prefix).toBe('ORD-');
  });

  const problems = (input: unknown) => {
    const result = workspaceConfigSchema.safeParse(input);
    if (result.success) throw new Error('expected a validation error');
    return zodIssuesToDetails(result.error);
  };

  it.each([
    ['sales.requiredDepositPercent', { sales: { requiredDepositPercent: 150 } }],
    ['sales.requiredDepositPercent', { sales: { requiredDepositPercent: -1 } }],
    ['sales.cashRoundingIncrement', { sales: { cashRoundingIncrement: 0 } }],
    ['locale.currency', { locale: { currency: 'usd' } }],
    ['locale.currencyDecimals', { locale: { currencyDecimals: 9 } }],
    ['locale.timezone', { locale: { timezone: 'Mars/Olympus' } }],
    ['locale.dateFormat', { locale: { dateFormat: 'YY' } }],
    ['modules.pos', { modules: { pos: 'yes' } }],
    [
      'numbering.QUOTATION.padding',
      { numbering: { QUOTATION: { prefix: 'Q', includeYear: true, padding: 0 } } },
    ],
    [
      'numbering.QUOTATION.prefix',
      { numbering: { QUOTATION: { prefix: 'bad prefix!!', includeYear: true, padding: 4 } } },
    ],
    ['documents.receiptPaper', { documents: { receiptPaper: 'A3' } }],
    ['documents.quotationValidityDays', { documents: { quotationValidityDays: 0 } }],
    ['ai.confidenceThreshold', { ai: { confidenceThreshold: 1.5 } }],
    ['ai.mode', { ai: { mode: 'ROBOT' } }],
    ['branding.primaryColor', { branding: { primaryColor: 'red' } }],
    ['business.email', { business: { email: 'not-an-email' } }],
    ['terminology.customer.singular', { terminology: { customer: { singular: '', plural: 'x' } } }],
    [
      'messaging.businessHours.mon.open',
      { messaging: { businessHours: { mon: { open: '9am', close: '17:00' } } } },
    ],
    ['duplicates.matchOn', { duplicates: { matchOn: [] } }],
    [
      'pos.allowMultipleOpenSessionsPerCashier',
      { pos: { allowMultipleOpenSessionsPerCashier: true } },
    ],
    ['inventory.valuationMethod', { inventory: { valuationMethod: 'FIFO' } }],
  ])('rejects an invalid value and names the path %s', (path, input) => {
    expect(Object.keys(problems(input))).toContain(path);
  });

  it('rejects unknown keys by name, at any depth', () => {
    const details = problems({ surprise: 1, sales: { bonus: true } });
    expect(details['surprise']).toEqual(['is not a known setting']);
    expect(details['sales.bonus']).toEqual(['is not a known setting']);
  });

  it('reports every problem at once', () => {
    const details = problems({
      sales: { requiredDepositPercent: 150 },
      locale: { currency: 'x' },
      modules: { pos: 1 },
    });
    expect(Object.keys(details).sort()).toEqual([
      'locale.currency',
      'modules.pos',
      'sales.requiredDepositPercent',
    ]);
  });
});

describe('optional text left empty in a form means "not set"', () => {
  it('drops empty optional values instead of rejecting them or storing blanks', () => {
    const parsed = workspaceConfigSchema.parse({
      business: { legalName: 'Acme', phone: '', email: '', address: '', taxNumber: '' },
      branding: { logoFileId: '', primaryColor: '' },
      documents: { receiptFooter: '', quotationTerms: '', invoiceTerms: '' },
    });
    expect(JSON.parse(JSON.stringify(parsed.business))).toEqual({ legalName: 'Acme' });
    expect(JSON.parse(JSON.stringify(parsed.branding))).toEqual({});
    expect(parsed.documents.receiptFooter).toBeUndefined();
    expect(Object.keys(JSON.parse(JSON.stringify(parsed.documents)))).not.toContain('invoiceTerms'); // as stored
  });

  it('still validates values that are given', () => {
    const result = workspaceConfigSchema.safeParse({
      business: { email: 'nope' },
      branding: { primaryColor: 'red' },
    });
    expect(result.success).toBe(false);
  });
});

describe('flatten', () => {
  it('produces dotted paths and keeps arrays and empty objects as leaves', () => {
    expect(flatten({ a: { b: 1, c: { d: [1, 2] } }, e: {}, f: null })).toEqual({
      'a.b': 1,
      'a.c.d': [1, 2],
      e: {},
      f: null,
    });
  });
});
