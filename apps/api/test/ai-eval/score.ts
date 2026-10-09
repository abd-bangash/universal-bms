import type { EvalConversation } from './conversations';

/** What the extraction returned for one detail, as far as scoring is concerned. */
export interface ScoredField {
  key: string;
  value: string;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ConversationScore {
  id: string;
  expected: number;
  correct: number;
  /** Expected details that were not extracted (or were extracted as LOW confidence). */
  missed: string[];
  /** Details extracted with confidence that are wrong or were never asked for: they would mislead staff. */
  wrong: string[];
}

export const normalizeValue = (v: string): string =>
  v
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Scores one conversation. A detail counts when it is extracted with HIGH or MEDIUM confidence and
 * has the expected value; LOW details are ignored, since staff are told not to trust them. The product
 * is one more detail. Anything confident that does not match the truth is "wrong".
 */
export function scoreConversation(
  conversation: Pick<EvalConversation, 'id' | 'expected'>,
  fields: ScoredField[],
  productCodes: string[],
): ConversationScore {
  const trusted = new Map(fields.filter((f) => f.level !== 'LOW').map((f) => [f.key, f.value]));
  const expected = Object.entries(conversation.expected.fields);
  const missed: string[] = [];
  const wrong: string[] = [];
  let correct = 0;
  for (const [key, value] of expected) {
    const got = trusted.get(key);
    if (got === undefined) missed.push(key);
    else if (normalizeValue(got) === normalizeValue(value)) correct += 1;
    else wrong.push(`${key}=${got}`);
  }
  for (const [key, got] of trusted) {
    if (!(key in conversation.expected.fields)) wrong.push(`${key}=${got}`);
  }
  let total = expected.length;
  if (conversation.expected.product) {
    total += 1;
    if (productCodes.includes(conversation.expected.product)) correct += 1;
    else missed.push('product');
  }
  if (!conversation.expected.product && productCodes.length > 0)
    wrong.push(`product=${productCodes.join(',')}`);
  if (
    conversation.expected.product &&
    productCodes.some((c) => c !== conversation.expected.product)
  ) {
    wrong.push(
      `product=${productCodes.filter((c) => c !== conversation.expected.product).join(',')}`,
    );
  }
  return { id: conversation.id, expected: total, correct, missed, wrong };
}

export interface EvalReport {
  conversations: number;
  expected: number;
  correct: number;
  accuracy: number;
  wrong: number;
  perConversation: ConversationScore[];
}

export function summarize(scores: ConversationScore[]): EvalReport {
  const expected = scores.reduce((n, s) => n + s.expected, 0);
  const correct = scores.reduce((n, s) => n + s.correct, 0);
  return {
    conversations: scores.length,
    expected,
    correct,
    accuracy: expected === 0 ? 1 : correct / expected,
    wrong: scores.reduce((n, s) => n + s.wrong.length, 0),
    perConversation: scores,
  };
}
