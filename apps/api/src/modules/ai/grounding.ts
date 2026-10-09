import Decimal from 'decimal.js';

/**
 * The deterministic checks that stand between the model and a person (Requirements 43.5, 43.6,
 * 43.15, 18.10). Nothing here calls a model: a check passes or fails on the text and the facts alone.
 */

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export const FLAGS = [
  'UNVERIFIED_AMOUNT',
  'UNVERIFIED_AVAILABILITY',
  'FINANCIAL_COMMITMENT',
  'LENGTH_EXCEEDED',
  'LOW_CONFIDENCE',
  'UNKNOWN_PRODUCT',
  'ESCALATION_KEYWORD',
  'ASKED_FOR_PERSON',
  'COMPLAINT',
] as const;
export type Flag = (typeof FLAGS)[number];

// ── is a value really in the conversation? ───────────────────────────────────────────────

const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
};

/** Lower case, no punctuation, single spaces, and small number words as digits ("one sofa" and "1 sofa" are the same). */
const normalize = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(
      /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g,
      (w) => NUMBER_WORDS[w] as string,
    );

/**
 * Whether the value is in the conversation text, as written or in an obvious variant (different
 * case, spacing or punctuation: "L-shaped" and "l shaped"). Every significant word of the value must
 * be there; a value the customer never said is not grounded, whatever the model believed.
 */
export function occursInText(value: string, conversationText: string): boolean {
  const wanted = normalize(value);
  if (wanted === '') return false;
  const haystack = normalize(conversationText);
  if (haystack.includes(wanted)) return true;
  const words = wanted.split(' ').filter((w) => w.length >= 3 || /\d/.test(w));
  if (words.length === 0) return false;
  const present = new Set(haystack.split(' '));
  return words.every((w) => present.has(w));
}

export interface GroundedField {
  key: string;
  value: string;
  /** What the model said, 0 to 1. */
  reported: number;
}

export interface CheckedField extends GroundedField {
  /** What we believe: capped when the value is not in the conversation. */
  confidence: number;
  level: ConfidenceLevel;
  grounded: boolean;
}

export const UNGROUNDED_CONFIDENCE_CAP = 0.3;

export function levelOf(confidence: number, threshold: number): ConfidenceLevel {
  if (confidence >= Math.max(0.8, threshold)) return 'HIGH';
  if (confidence >= threshold) return 'MEDIUM';
  return 'LOW';
}

/** Requirement 43.15: a value not explicitly present in the conversation is LOW, whatever the model reported. */
export function checkField(
  field: GroundedField,
  conversationText: string,
  threshold: number,
): CheckedField {
  const reported = Math.min(1, Math.max(0, Number.isFinite(field.reported) ? field.reported : 0));
  const grounded = occursInText(field.value, conversationText);
  const confidence = grounded ? reported : Math.min(reported, UNGROUNDED_CONFIDENCE_CAP);
  return {
    ...field,
    reported,
    grounded,
    confidence,
    level: grounded ? levelOf(confidence, threshold) : 'LOW',
  };
}

// ── money and availability in a draft ────────────────────────────────────────────────────

const CURRENCY_BEFORE = String.raw`(?:pkr|rs\.?|rupees?|₨|usd|us\$|\$|€|£|inr|aed|gbp|eur)`;
const AMOUNT = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;

/**
 * Every money amount a draft mentions. A number counts when it sits next to a currency word or
 * symbol, or is written with thousands separators, or is four digits or more and not a year.
 * "3 weeks", "8 feet" and "SOFA-1234" are not amounts.
 */
export function amountsIn(text: string, currencyCode?: string): Decimal[] {
  const found: Decimal[] = [];
  const code = currencyCode ? currencyCode.toLowerCase() : null;
  const marker = code ? `(?:${CURRENCY_BEFORE}|${code})` : CURRENCY_BEFORE;
  const re = new RegExp(
    String.raw`(?<![\p{L}\p{N}-])(?:(${marker})\s*)?(${AMOUNT})(?:\s*(${marker}|/-|k\b))?(?![\p{L}\p{N}]|\.\d)`,
    'giu',
  );
  for (const m of text.matchAll(re)) {
    const before = m[1];
    const raw = m[2] as string;
    const after = m[3];
    const digits = raw.replace(/,/g, '');
    const plain = /^\d{4,}$/.test(digits) && !/^(19|20)\d{2}$/.test(digits);
    const grouped = raw.includes(',');
    if (!before && !after && !grouped && !plain) continue;
    let value = new Decimal(digits);
    if (after?.toLowerCase() === 'k') value = value.times(1000);
    found.push(value);
  }
  return found;
}

export interface ProductFact {
  availability: 'IN_STOCK' | 'OUT_OF_STOCK' | 'MADE_TO_ORDER' | 'NOT_TRACKED';
  quantity?: string;
}

/** The facts a draft is allowed to state, all read from the database or approved by the business. */
export interface DraftFacts {
  /** Prices (and other figures) the business has stated: catalog prices, knowledge items, earlier staff messages, bank details. */
  amounts: Decimal[];
  products: ProductFact[];
  /** Text of approved knowledge items and earlier staff messages, where a stated delivery time may legitimately come from. */
  statedText: string;
  currencyCode?: string;
  maxChars?: number;
}

const IN_STOCK =
  /\b(in[- ]stock|available (now|today|immediately)|ready (stock|to (ship|deliver|collect))|we have (it|them|this|these)\b|currently available|is available|are available)\b/i;
const OUT_OF_STOCK = /\b(out of stock|sold out|not available|unavailable|currently unavailable)\b/i;
const MADE_TO_ORDER =
  /\b(made[- ]to[- ]order|make (?:\w+ )?to[- ]order|made on order|custom[- ]made|built to order)\b/i;
const QUANTITY_LEFT =
  /\b(\d+)\s*(?:pieces?|pcs|units?|items?|sets?)\s*(?:left|remaining|in stock|available)\b/i;

const DISCOUNT =
  /\b(discount|\d+\s*%\s*off|percent off|special (price|offer|rate)|reduce(d)? (the )?price|lower (the )?price|best price|cut (the )?price|waive)\b/i;
const PAYMENT_CONFIRMED =
  /\b((payment|deposit|amount|transfer|money)\b[^.!?]{0,30}\b(received|confirmed|verified|cleared|arrived)|(received|confirmed|verified|got) (your )?(payment|deposit|transfer|money))\b/i;
const REFUND = /\b(refund|money back|reimburse|chargeback)\w*\b/i;
const DELIVERY_PROMISE =
  /\b(deliver(?:y|ed)?|arriv(?:e|al)|ready|dispatch(?:ed)?|ship(?:ped)?)\b[^.!?]{0,40}\b(by|on|within|in|before|next|tomorrow|tonight)\b[^.!?]{0,25}(\d+|tomorrow|tonight|next week|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;

export interface DraftCheck {
  flags: Flag[];
  /** Plain-language reasons, for the person reviewing the draft. */
  reasons: string[];
}

/** Checks a draft reply against the facts it was allowed to use (Requirements 43.5, 43.6, 18.10). */
export function checkDraft(text: string, facts: DraftFacts): DraftCheck {
  const flags = new Set<Flag>();
  const reasons: string[] = [];
  const flag = (f: Flag, reason: string) => {
    flags.add(f);
    reasons.push(reason);
  };

  for (const amount of amountsIn(text, facts.currencyCode)) {
    if (!facts.amounts.some((a) => a.eq(amount))) {
      flag(
        'UNVERIFIED_AMOUNT',
        `The amount ${amount.toFixed()} is not in the catalog or the approved texts.`,
      );
    }
  }

  const claimsInStock = IN_STOCK.test(text) && !OUT_OF_STOCK.test(text);
  if (claimsInStock && !facts.products.some((p) => p.availability === 'IN_STOCK')) {
    flag(
      'UNVERIFIED_AVAILABILITY',
      'It says something is available, but no matching product is in stock.',
    );
  }
  if (OUT_OF_STOCK.test(text) && !facts.products.some((p) => p.availability === 'OUT_OF_STOCK')) {
    flag(
      'UNVERIFIED_AVAILABILITY',
      'It says something is unavailable, but that is not in the stock data.',
    );
  }
  if (MADE_TO_ORDER.test(text) && !facts.products.some((p) => p.availability === 'MADE_TO_ORDER')) {
    flag(
      'UNVERIFIED_AVAILABILITY',
      'It says something is made to order, but that is not in the catalog.',
    );
  }
  const left = QUANTITY_LEFT.exec(text);
  if (left) {
    const n = new Decimal(left[1] as string);
    if (!facts.products.some((p) => p.quantity !== undefined && new Decimal(p.quantity).eq(n))) {
      flag(
        'UNVERIFIED_AVAILABILITY',
        `It says ${n.toFixed()} are left, but the stock data says otherwise.`,
      );
    }
  }

  if (DISCOUNT.test(text)) flag('FINANCIAL_COMMITMENT', 'It offers or mentions a discount.');
  if (PAYMENT_CONFIRMED.test(text)) flag('FINANCIAL_COMMITMENT', 'It confirms a payment.');
  if (REFUND.test(text)) flag('FINANCIAL_COMMITMENT', 'It mentions a refund.');
  const promise = DELIVERY_PROMISE.exec(text);
  if (promise && !normalize(facts.statedText).includes(normalize(promise[0]))) {
    flag('FINANCIAL_COMMITMENT', 'It promises a delivery time that is not in the data.');
  }

  if (facts.maxChars !== undefined && text.length > facts.maxChars) {
    flag('LENGTH_EXCEEDED', `It is longer than the ${facts.maxChars} characters allowed.`);
  }
  return { flags: [...flags], reasons };
}

// ── escalation ───────────────────────────────────────────────────────────────────────────

const ASKS_FOR_PERSON =
  /\b(speak|talk|connect|transfer)\b[^.!?]{0,25}\b(to|with)\b[^.!?]{0,15}\b(a |an |the )?(person|human|agent|representative|someone|manager|owner|staff)\b|\b(real|actual) (person|human)\b|\bhuman agent\b/i;

export interface Escalation {
  flags: Flag[];
  reasons: string[];
}

/** Whether the customer's last message needs a person at once (Requirement 43.11). */
export function escalationFor(lastInbound: string, keywords: readonly string[]): Escalation {
  const flags: Flag[] = [];
  const reasons: string[] = [];
  const text = lastInbound.toLowerCase();
  const hit = keywords
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .find((k) => text.includes(k));
  if (hit) {
    flags.push('ESCALATION_KEYWORD');
    reasons.push(`The customer used "${hit}".`);
  }
  if (ASKS_FOR_PERSON.test(lastInbound)) {
    flags.push('ASKED_FOR_PERSON');
    reasons.push('The customer asked for a person.');
  }
  return { flags, reasons };
}
