import type { ContextPack } from '../context.types';

/**
 * Turns the context pack into the text the model reads. This is the only place data is turned into
 * prompt text, so what is sent to the provider is exactly the pack (design.md "AI", step 2).
 */
export function renderPack(
  pack: ContextPack,
  sections: Array<keyof ContextPack | 'conversation'>,
): string {
  const out: string[] = [];
  const has = (s: keyof ContextPack | 'conversation') => sections.includes(s);

  out.push(
    `Business: ${pack.business.name || '(unnamed)'}; industry: ${pack.business.industryProfile}; currency: ${pack.business.currency}.`,
  );
  if (pack.customerName) out.push(`The customer's name on the channel: ${pack.customerName}.`);
  if (has('fields')) {
    out.push(
      'Details worth collecting (key — meaning — type):\n' +
        pack.fields
          .map((f) => `- ${f.key} — ${f.label} — ${f.type}${f.required ? ' — required' : ''}`)
          .join('\n'),
    );
  }
  if (has('known') && Object.keys(pack.known).length > 0) {
    out.push(
      'Already recorded about this person:\n' +
        Object.entries(pack.known)
          .map(([k, v]) => `- ${k}: ${v}`)
          .join('\n'),
    );
  }
  if (has('products')) {
    out.push(
      pack.products.length === 0
        ? 'Matching products: none. Do not name or invent a product.'
        : 'Matching products (id — name — price — availability):\n' +
            pack.products
              .map(
                (p) =>
                  `- ${p.id} — ${p.name} (${p.code}) — ${p.price} ${pack.business.currency} — ${p.availability}${p.quantity ? ` (${p.quantity} available)` : ''}`,
              )
              .join('\n'),
    );
  }
  if (has('knowledge') && pack.knowledge.length > 0) {
    out.push(
      'Approved business information (the only policies and facts you may state):\n' +
        pack.knowledge.map((k) => `## ${k.title}\n${k.body}`).join('\n\n'),
    );
  }
  if (has('bankAccounts') && pack.bankAccounts.length > 0) {
    out.push(
      'Accounts customers may pay into:\n' +
        pack.bankAccounts
          .map((b) =>
            Object.entries(b)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', '),
          )
          .join('\n'),
    );
  }
  if (has('questionFlow') && pack.questionFlow.length > 0) {
    out.push(
      'Questions to ask, in order, for details still missing:\n' +
        pack.questionFlow.map((q) => `- ${q.fieldKey}: ${q.question}`).join('\n'),
    );
  }
  return out.join('\n\n');
}

/** The conversation as the model reads it: one line per message, oldest first. */
export function renderConversation(pack: ContextPack): string {
  return pack.messages
    .map(
      (m) =>
        `${m.from === 'CUSTOMER' ? 'Customer' : m.from === 'STAFF' ? 'Staff' : 'Assistant'}: ${m.text}`,
    )
    .join('\n');
}

export const RULES = [
  `Use only the information given to you below. Never invent a price, a stock level, a policy, a bank detail, a payment status or a delivery date.`,
  `If something you are asked about is not in the information, say that a member of staff will confirm it.`,
  `Never offer a discount, confirm a payment, promise a refund or promise a delivery date.`,
].join(' ');

export function styleLine(pack: ContextPack): string {
  const language =
    pack.style.replyLanguage === 'MATCH_CUSTOMER'
      ? 'Write in the language the customer writes in.'
      : `Write in ${pack.style.replyLanguage}.`;
  return `Tone: ${pack.style.tone === 'FORMAL' ? 'formal and polite' : 'friendly and warm'}. ${language} Keep it under ${pack.style.maxReplyChars} characters.`;
}
