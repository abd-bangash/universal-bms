import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ContextPack } from '../context.types';

/** A pack with every field filled; if the type gains a field this stops compiling until it is added here. */
const PACK: Record<keyof ContextPack, true> = {
  business: true,
  style: true,
  customerName: true,
  questionFlow: true,
  fields: true,
  knowledge: true,
  products: true,
  bankAccounts: true,
  messages: true,
  customerText: true,
  statedText: true,
  amounts: true,
  known: true,
};

describe('docs/ai-data-handling.md', () => {
  const doc = readFileSync(
    resolve(__dirname, '../../../../../../docs/ai-data-handling.md'),
    'utf8',
  );

  it.each(Object.keys(PACK))('lists the context pack field %s', (field) => {
    expect(doc).toContain(`\`${field}\``);
  });

  it('says what is never sent, what is kept and how to switch AI off', () => {
    for (const heading of [
      '## What is never sent',
      '## What is kept',
      '## Switching it off',
      '## When anything is sent',
    ]) {
      expect(doc).toContain(heading);
    }
    expect(doc).toMatch(/cost prices/i);
    expect(doc).toMatch(/hash of the prompt/);
  });
});
