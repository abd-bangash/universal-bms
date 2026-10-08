/** Keys of the per-workspace terminology map (Requirement 28.1). */
export const TERM_KEYS = [
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
export type TermKey = (typeof TERM_KEYS)[number];

export type Terminology = Record<TermKey, { singular: string; plural: string }>;

/** Industry-neutral wording; an Industry Profile replaces the terms the business has not edited. */
export const DEFAULT_TERMINOLOGY: Terminology = {
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

export const MODULE_KEYS = [
  'pos',
  'purchasing',
  'commissions',
  'messaging',
  'ai',
  'automation',
  'production',
  'priceLists',
  'multiLocation',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];
export type ModuleToggles = Record<ModuleKey, boolean>;

export const DEFAULT_MODULES: ModuleToggles = {
  pos: true,
  purchasing: true,
  commissions: true,
  messaging: true,
  ai: true,
  automation: false,
  production: false,
  priceLists: false,
  multiLocation: false,
};

export const DOCUMENT_TYPES = [
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
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface NumberingFormat {
  prefix: string;
  includeYear: boolean;
  padding: number;
}

export interface WeeklyHours {
  [day: string]: { open: string; close: string } | null;
}

/** The per-workspace configuration document (design.md "Workspace settings"). */
export interface WorkspaceConfig {
  business: {
    legalName: string;
    phone?: string;
    email?: string;
    address?: string;
    taxNumber?: string;
  };
  branding: { logoFileId?: string; primaryColor?: string };
  locale: {
    currency: string;
    currencyDecimals: number;
    timezone: string;
    language: string;
    dateFormat: string;
    /** ISO 3166 alpha-2 country used to read phone numbers written without a country code. */
    defaultCountry?: string;
  };
  modules: ModuleToggles;
  tax: { enabled: boolean; pricesIncludeTax: boolean; defaultTaxClassId?: string };
  numbering: Record<DocumentType, NumberingFormat>;
  documents: {
    receiptPaper: '58mm' | '80mm' | 'A4';
    receiptFooter?: string;
    quotationTerms?: string;
    invoiceTerms?: string;
    showBankDetails: boolean;
    quotationValidityDays: number;
    autoInvoiceOnSystemRole?: 'DELIVERED' | 'COMPLETED' | null;
  };
  sales: {
    requiredDepositPercent: number;
    discountOverLimit: 'REJECT' | 'APPROVAL';
    cashRoundingIncrement: number | null;
    leadDedupWindowHours: number;
  };
  inventory: {
    allowNegativeStock: boolean;
    valuationMethod: 'WEIGHTED_AVERAGE';
    adjustmentApprovalThreshold: number | null;
    defaultLocationId?: string;
  };
  commission: { triggerSystemRole: 'COMPLETED' | 'DELIVERED' | 'CONFIRMED' };
  pos: { requireSessionFloat: boolean; allowMultipleOpenSessionsPerCashier: false };
  messaging: { automationEnabled: boolean; businessHours?: WeeklyHours; optOutKeywords: string[] };
  ai: {
    mode: 'OFF' | 'ASSIST' | 'AUTO_REPLY';
    provider?: string;
    model?: string;
    tone: 'FORMAL' | 'FRIENDLY';
    replyLanguage: 'MATCH_CUSTOMER' | string;
    maxReplyChars: number;
    confidenceThreshold: number;
    escalationKeywords: string[];
    contextMessageCount: number;
    visionEnabled: boolean;
    dailyRequestLimit: number;
    monthlyTokenBudget: number;
    autoReplyCategories: string[];
  };
  retention: { messagesMonths: number | null; aiLogsMonths: number | null };
  terminology: Terminology;
  duplicates: { matchOn: Array<'PHONE' | 'EMAIL' | 'NAME_SIMILAR'> };
}
