import {
  DEFAULT_MODULES,
  DEFAULT_TERMINOLOGY,
  DOCUMENT_TYPES,
  type DocumentType,
  type NumberingFormat,
  type WorkspaceConfig,
} from '@bms/types';

const NUMBERING: Record<DocumentType, NumberingFormat> = {
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

export interface DefaultConfigInput {
  legalName: string;
  currency?: string;
  timezone?: string;
  language?: string;
}

/** The configuration every new workspace starts with; the Industry Profile then adjusts it. */
export function createDefaultConfig(input: DefaultConfigInput): WorkspaceConfig {
  return {
    business: { legalName: input.legalName },
    branding: {},
    locale: {
      currency: input.currency ?? 'USD',
      currencyDecimals: 2,
      timezone: input.timezone ?? 'UTC',
      language: input.language ?? 'en',
      dateFormat: 'DD/MM/YYYY',
    },
    modules: { ...DEFAULT_MODULES },
    tax: { enabled: false, pricesIncludeTax: false },
    numbering: Object.fromEntries(DOCUMENT_TYPES.map((t) => [t, { ...NUMBERING[t] }])) as Record<
      DocumentType,
      NumberingFormat
    >,
    documents: {
      receiptPaper: '80mm',
      showBankDetails: true,
      quotationValidityDays: 14,
      autoInvoiceOnSystemRole: 'DELIVERED',
    },
    sales: {
      requiredDepositPercent: 0,
      discountOverLimit: 'REJECT',
      cashRoundingIncrement: null,
      leadDedupWindowHours: 24,
    },
    inventory: {
      allowNegativeStock: false,
      valuationMethod: 'WEIGHTED_AVERAGE',
      adjustmentApprovalThreshold: null,
    },
    commission: { triggerSystemRole: 'COMPLETED' },
    pos: { requireSessionFloat: false, allowMultipleOpenSessionsPerCashier: false },
    messaging: { automationEnabled: false, optOutKeywords: ['STOP', 'UNSUBSCRIBE'] },
    ai: {
      mode: 'OFF',
      tone: 'FRIENDLY',
      replyLanguage: 'MATCH_CUSTOMER',
      maxReplyChars: 600,
      confidenceThreshold: 0.7,
      escalationKeywords: ['refund', 'complaint', 'lawyer', 'manager'],
      contextMessageCount: 10,
      visionEnabled: false,
      dailyRequestLimit: 500,
      monthlyTokenBudget: 2_000_000,
      autoReplyCategories: [],
    },
    retention: { messagesMonths: null, aiLogsMonths: 12 },
    terminology: structuredClone(DEFAULT_TERMINOLOGY),
    duplicates: { matchOn: ['PHONE', 'EMAIL'] },
  };
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep merge of plain objects; arrays and scalars in `override` replace. */
export function mergeConfig<T extends object>(base: T, override: Json): T {
  const out: Json = { ...(base as Json) };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isObject(value) && isObject(out[key]) ? mergeConfig(out[key] as Json, value) : value;
  }
  return out as T;
}
