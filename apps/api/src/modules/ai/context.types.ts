import type { ProductFact } from './grounding';

export interface PackProduct extends ProductFact {
  id: string;
  code: string;
  name: string;
  /** Current price as a decimal string. */
  price: string;
  /** How well the product matches the conversation, 0 to 1. */
  score: number;
}

export interface PackMessage {
  from: 'CUSTOMER' | 'STAFF' | 'ASSISTANT';
  text: string;
}

export interface PackField {
  key: string;
  label: string;
  type: string;
  required: boolean;
}

/**
 * Everything the model is told, and nothing else (design.md "AI", step 2; Requirement 43.12).
 * `docs/ai-data-handling.md` lists each of these fields. There are no credentials, no cost prices, no
 * other customers and no staff personal data in it.
 */
export interface ContextPack {
  business: { name: string; industryProfile: string; currency: string };
  style: { tone: 'FORMAL' | 'FRIENDLY'; replyLanguage: string; maxReplyChars: number };
  /** The customer's name as they gave it, if the conversation has one. */
  customerName: string | null;
  /** Ordered questions to ask for the missing details (Requirement 43.3). */
  questionFlow: Array<{ fieldKey: string; question: string }>;
  /** Details worth collecting: the core ones and the configured required fields. */
  fields: PackField[];
  knowledge: Array<{ title: string; body: string }>;
  products: PackProduct[];
  /** Only present when the customer is asking where to pay. */
  bankAccounts: Array<Record<string, string>>;
  messages: PackMessage[];
  /** What the customer has said, newest last; the evidence extracted values are checked against. */
  customerText: string;
  /** The facts a draft may state: price figures and the text they come from. */
  statedText: string;
  amounts: string[];
  /** Details already recorded on the lead, so they are not asked for again. */
  known: Record<string, string>;
}

/** The details the AI can fill in on a lead, besides the configured fields. */
export const CORE_FIELDS: PackField[] = [
  { key: 'fullName', label: 'Name', type: 'TEXT', required: false },
  { key: 'email', label: 'Email', type: 'TEXT', required: false },
  { key: 'interest', label: 'What they want', type: 'TEXT', required: false },
  { key: 'requirements', label: 'Requirements in detail', type: 'TEXT', required: false },
  { key: 'quantity', label: 'Quantity', type: 'NUMBER', required: false },
  { key: 'budget', label: 'Budget', type: 'MONEY', required: false },
];
