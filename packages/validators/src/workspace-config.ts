import { z } from 'zod';

const termKeys = [
  'customer',
  'lead',
  'order',
  'quotation',
  'product',
  'variant',
  'salesperson',
  'supplier',
  'purchaseOrder',
  'location',
  'productionJob',
] as const;
const docTypes = [
  'QUOTATION',
  'ORDER',
  'INVOICE',
  'RECEIPT',
  'REFUND_RECEIPT',
  'PURCHASE_ORDER',
  'GOODS_RECEIPT',
  'RETURN',
  'PAYMENT',
] as const;

const DEFAULT_TERMS: Record<(typeof termKeys)[number], { singular: string; plural: string }> = {
  customer: { singular: 'Customer', plural: 'Customers' },
  lead: { singular: 'Lead', plural: 'Leads' },
  order: { singular: 'Order', plural: 'Orders' },
  quotation: { singular: 'Quotation', plural: 'Quotations' },
  product: { singular: 'Product', plural: 'Products' },
  variant: { singular: 'Variant', plural: 'Variants' },
  salesperson: { singular: 'Salesperson', plural: 'Salespeople' },
  supplier: { singular: 'Supplier', plural: 'Suppliers' },
  purchaseOrder: { singular: 'Purchase Order', plural: 'Purchase Orders' },
  location: { singular: 'Location', plural: 'Locations' },
  productionJob: { singular: 'Production Job', plural: 'Production Jobs' },
};

const DEFAULT_NUMBERING: Record<
  (typeof docTypes)[number],
  { prefix: string; includeYear: boolean; padding: number }
> = {
  QUOTATION: { prefix: 'QT-', includeYear: true, padding: 4 },
  ORDER: { prefix: 'ORD-', includeYear: true, padding: 4 },
  INVOICE: { prefix: 'INV-', includeYear: true, padding: 4 },
  RECEIPT: { prefix: 'RCP-', includeYear: true, padding: 5 },
  REFUND_RECEIPT: { prefix: 'RFD-', includeYear: true, padding: 4 },
  PURCHASE_ORDER: { prefix: 'PO-', includeYear: true, padding: 4 },
  GOODS_RECEIPT: { prefix: 'GRN-', includeYear: true, padding: 4 },
  RETURN: { prefix: 'RET-', includeYear: true, padding: 4 },
  PAYMENT: { prefix: 'PAY-', includeYear: true, padding: 5 },
};

const isTimezone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const text = (max: number) => z.string().max(max);
/** Optional text where an empty string from a form means "not set". */
const optionalText = (max: number) =>
  z.preprocess((v) => (v === '' ? undefined : v), z.string().max(max).optional());
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');
const hours = z.object({ open: hhmm, close: hhmm }).strict().nullable();

const business = z
  .object({
    legalName: z.string().trim().min(1).max(200).default('My Business'),
    phone: optionalText(40),
    email: z.preprocess((v) => (v === '' ? undefined : v), z.string().email().max(254).optional()),
    address: optionalText(500),
    taxNumber: optionalText(60),
  })
  .strict();

const branding = z
  .object({
    logoFileId: optionalText(100),
    primaryColor: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, 'must be a #RRGGBB colour')
        .optional(),
    ),
  })
  .strict();

const locale = z
  .object({
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'must be a 3-letter ISO currency code')
      .default('USD'),
    currencyDecimals: z.number().int().min(0).max(4).default(2),
    timezone: z.string().refine(isTimezone, 'must be a valid IANA timezone').default('UTC'),
    language: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/, 'must be a language code such as en')
      .default('en'),
    dateFormat: z
      .enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'D MMM YYYY'])
      .default('DD/MM/YYYY'),
    defaultCountry: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z
        .string()
        .regex(/^[A-Z]{2}$/, 'must be a 2-letter country code such as PK')
        .optional(),
    ),
  })
  .strict();

const moduleToggles = z
  .object({
    pos: z.boolean().default(true),
    purchasing: z.boolean().default(true),
    commissions: z.boolean().default(true),
    messaging: z.boolean().default(true),
    ai: z.boolean().default(true),
    automation: z.boolean().default(false),
    production: z.boolean().default(false),
    priceLists: z.boolean().default(false),
    multiLocation: z.boolean().default(false),
  })
  .strict();

const numberingFormat = z
  .object({
    prefix: z.string().regex(/^[A-Za-z0-9\-_/]{0,10}$/, 'up to 10 letters, digits, - _ /'),
    includeYear: z.boolean(),
    padding: z.number().int().min(1).max(10),
  })
  .strict();

const numbering = z
  .object(
    Object.fromEntries(
      docTypes.map((t) => [t, numberingFormat.default(DEFAULT_NUMBERING[t])]),
    ) as Record<(typeof docTypes)[number], z.ZodDefault<typeof numberingFormat>>,
  )
  .strict();

const documents = z
  .object({
    receiptPaper: z.enum(['58mm', '80mm', 'A4']).default('80mm'),
    receiptFooter: optionalText(500),
    quotationTerms: optionalText(5000),
    invoiceTerms: optionalText(5000),
    showBankDetails: z.boolean().default(true),
    quotationValidityDays: z.number().int().min(1).max(365).default(14),
    autoInvoiceOnSystemRole: z
      .enum(['DELIVERED', 'COMPLETED'])
      .nullable()
      .optional()
      .default('DELIVERED'),
  })
  .strict();

const sales = z
  .object({
    requiredDepositPercent: z.number().min(0).max(100).default(0),
    discountOverLimit: z.enum(['REJECT', 'APPROVAL']).default('REJECT'),
    cashRoundingIncrement: z.number().positive().nullable().default(null),
    leadDedupWindowHours: z.number().int().min(0).max(720).default(24),
  })
  .strict();

const inventory = z
  .object({
    allowNegativeStock: z.boolean().default(false),
    valuationMethod: z.literal('WEIGHTED_AVERAGE').default('WEIGHTED_AVERAGE'),
    adjustmentApprovalThreshold: z.number().min(0).nullable().default(null),
    defaultLocationId: text(100).optional(),
  })
  .strict();

const messaging = z
  .object({
    automationEnabled: z.boolean().default(false),
    businessHours: z
      .record(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']), hours)
      .optional(),
    optOutKeywords: z
      .array(z.string().trim().min(1).max(40))
      .max(20)
      .default(['STOP', 'UNSUBSCRIBE']),
  })
  .strict();

const ai = z
  .object({
    mode: z.enum(['OFF', 'ASSIST', 'AUTO_REPLY']).default('OFF'),
    provider: text(60).optional(),
    model: text(100).optional(),
    tone: z.enum(['FORMAL', 'FRIENDLY']).default('FRIENDLY'),
    replyLanguage: text(20).default('MATCH_CUSTOMER'),
    maxReplyChars: z.number().int().min(50).max(4000).default(600),
    confidenceThreshold: z.number().min(0).max(1).default(0.7),
    escalationKeywords: z
      .array(z.string().trim().min(1).max(60))
      .max(50)
      .default(['refund', 'complaint', 'lawyer', 'manager']),
    contextMessageCount: z.number().int().min(1).max(50).default(10),
    visionEnabled: z.boolean().default(false),
    dailyRequestLimit: z.number().int().min(0).default(500),
    monthlyTokenBudget: z.number().int().min(0).default(2_000_000),
    autoReplyCategories: z.array(z.string().max(60)).max(50).default([]),
  })
  .strict();

const term = z
  .object({ singular: z.string().trim().min(1).max(60), plural: z.string().trim().min(1).max(60) })
  .strict();
const terminology = z
  .object(
    Object.fromEntries(termKeys.map((k) => [k, term.default(DEFAULT_TERMS[k])])) as Record<
      (typeof termKeys)[number],
      z.ZodDefault<typeof term>
    >,
  )
  .strict();

/** The whole per-workspace configuration (design.md "Workspace settings"). Every section has defaults. */
export const workspaceConfigSchema = z
  .object({
    business: business.prefault({}),
    branding: branding.prefault({}),
    locale: locale.prefault({}),
    modules: moduleToggles.prefault({}),
    tax: z
      .object({
        enabled: z.boolean().default(false),
        pricesIncludeTax: z.boolean().default(false),
        defaultTaxClassId: text(100).optional(),
      })
      .strict()
      .prefault({}),
    numbering: numbering.prefault({}),
    documents: documents.prefault({}),
    sales: sales.prefault({}),
    inventory: inventory.prefault({}),
    commission: z
      .object({
        triggerSystemRole: z.enum(['COMPLETED', 'DELIVERED', 'CONFIRMED']).default('COMPLETED'),
      })
      .strict()
      .prefault({}),
    pos: z
      .object({
        requireSessionFloat: z.boolean().default(false),
        allowMultipleOpenSessionsPerCashier: z.literal(false).default(false),
      })
      .strict()
      .prefault({}),
    messaging: messaging.prefault({}),
    ai: ai.prefault({}),
    retention: z
      .object({
        messagesMonths: z.number().int().min(1).nullable().default(null),
        aiLogsMonths: z.number().int().min(1).nullable().default(12),
      })
      .strict()
      .prefault({}),
    terminology: terminology.prefault({}),
    duplicates: z
      .object({
        matchOn: z
          .array(z.enum(['PHONE', 'EMAIL', 'NAME_SIMILAR']))
          .min(1)
          .refine((a) => new Set(a).size === a.length, 'must not repeat')
          .default(['PHONE', 'EMAIL']),
      })
      .strict()
      .prefault({}),
  })
  .strict();

export type WorkspaceConfigInput = z.input<typeof workspaceConfigSchema>;
export type ValidatedWorkspaceConfig = z.output<typeof workspaceConfigSchema>;

/** Field-level messages keyed by dotted path, for API validation errors. */
export function zodIssuesToDetails(error: z.ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const base = issue.path.map(String).join('.');
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys)
        (details[base ? `${base}.${key}` : key] ??= []).push('is not a known setting');
      continue;
    }
    (details[base || 'config'] ??= []).push(issue.message);
  }
  return details;
}
