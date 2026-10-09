import Decimal from 'decimal.js';
import * as fc from 'fast-check';
import {
  amountsIn,
  checkDraft,
  checkField,
  escalationFor,
  occursInText,
  UNGROUNDED_CONFIDENCE_CAP,
  type DraftFacts,
} from '../grounding';

const facts = (over: Partial<DraftFacts> = {}): DraftFacts => ({
  amounts: [new Decimal(45000)],
  products: [{ availability: 'IN_STOCK', quantity: '3' }],
  statedText: 'Delivery within 3 weeks of the deposit.',
  currencyCode: 'PKR',
  ...over,
});

describe('occursInText', () => {
  const chat = 'Hi, I want an L-shaped sofa, about 8 feet, in brown leather';
  it.each([
    ['brown leather', true],
    ['L shaped', true],
    ['LEATHER', true],
    ['8 feet', true],
    ['green fabric', false],
    ['8 meters', false],
    ['', false],
  ])('%s → %s', (value, expected) => expect(occursInText(value, chat)).toBe(expected));
});

describe('Property 19 — grounding validator', () => {
  const words = fc.stringMatching(/^[a-z]{5,10}$/);

  it('a value that is not in the conversation is LOW and capped, whatever the model reported', () => {
    fc.assert(
      fc.property(
        words,
        words,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (said, invented, reported) => {
          fc.pre(!said.includes(invented) && !invented.includes(said));
          const chat = `the customer said ${said} and nothing else`;
          const out = checkField({ key: 'colour', value: invented, reported }, chat, 0.7);
          expect(out.grounded).toBe(false);
          expect(out.level).toBe('LOW');
          expect(out.confidence).toBeLessThanOrEqual(UNGROUNDED_CONFIDENCE_CAP);
          expect(out.confidence).toBeLessThanOrEqual(reported);
        },
      ),
    );
  });

  it('a value that is in the conversation keeps what the model reported (clamped to 0..1)', () => {
    fc.assert(
      fc.property(words, fc.double({ min: -2, max: 3, noNaN: true }), (value, reported) => {
        const out = checkField(
          { key: 'colour', value, reported },
          `I like ${value.toUpperCase()} a lot`,
          0.7,
        );
        expect(out.grounded).toBe(true);
        expect(out.confidence).toBe(Math.min(1, Math.max(0, reported)));
      }),
    );
  });

  it('a draft that states any amount not among the allowed ones is flagged; one that states only allowed amounts is not', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 9_999_999 }),
        fc.integer({ min: 1000, max: 9_999_999 }),
        (allowed, other) => {
          fc.pre(allowed !== other && !(other >= 1900 && other <= 2099));
          const f = facts({ amounts: [new Decimal(allowed)] });
          const fmt = (n: number) => n.toLocaleString('en-US');
          expect(checkDraft(`The price is Rs ${fmt(allowed)}.`, f).flags).not.toContain(
            'UNVERIFIED_AMOUNT',
          );
          expect(checkDraft(`The price is Rs ${fmt(other)}.`, f).flags).toContain(
            'UNVERIFIED_AMOUNT',
          );
          expect(checkDraft(`It is PKR ${other} plus Rs. ${fmt(allowed)}`, f).flags).toContain(
            'UNVERIFIED_AMOUNT',
          );
        },
      ),
    );
  });
});

describe('draft checks (77.2)', () => {
  it('flags a price that is not in the context pack', () => {
    const out = checkDraft('This sofa costs Rs 52,000.', facts());
    expect(out.flags).toEqual(['UNVERIFIED_AMOUNT']);
    expect(out.reasons[0]).toContain('52000');
  });

  it('accepts the catalog price in any common spelling', () => {
    for (const text of ['It is Rs 45,000.', 'PKR 45000', '45,000/-', 'Rs.45000 only', '45k PKR']) {
      expect(checkDraft(text, facts()).flags).toEqual([]);
    }
  });

  it('does not mistake quantities, years, sizes or product codes for money', () => {
    expect(amountsIn('3 weeks, 8 feet, 2 seaters, in 2026, SOFA-12000, 120 cm')).toEqual([]);
    expect(amountsIn('Rs 1,500.50 and $20').map(String)).toEqual(['1500.5', '20']);
  });

  it('checks availability claims against the stock data', () => {
    expect(checkDraft('Yes, it is in stock.', facts()).flags).toEqual([]);
    expect(checkDraft('Yes, it is in stock.', facts({ products: [] })).flags).toEqual([
      'UNVERIFIED_AVAILABILITY',
    ]);
    expect(
      checkDraft('Yes, it is in stock.', facts({ products: [{ availability: 'OUT_OF_STOCK' }] }))
        .flags,
    ).toEqual(['UNVERIFIED_AVAILABILITY']);
    expect(
      checkDraft(
        'Sorry, that is out of stock.',
        facts({ products: [{ availability: 'OUT_OF_STOCK' }] }),
      ).flags,
    ).toEqual([]);
    expect(checkDraft('We make it to order.', facts()).flags).toEqual(['UNVERIFIED_AVAILABILITY']);
    expect(
      checkDraft('We make it to order.', facts({ products: [{ availability: 'MADE_TO_ORDER' }] }))
        .flags,
    ).toEqual([]);
    expect(checkDraft('Only 2 pieces left.', facts()).flags).toEqual(['UNVERIFIED_AVAILABILITY']);
    expect(checkDraft('Only 3 pieces left.', facts()).flags).toEqual([]);
  });

  it.each([
    ['I can give you a 10% off if you order today.', 'discount'],
    ['We offer a special price for you.', 'discount'],
    ['Thank you, your payment has been received.', 'payment'],
    ['We have received your payment of the deposit.', 'payment'],
    ['We will refund the amount.', 'refund'],
    ['It will be delivered by Friday.', 'delivery'],
    ['Your order will be ready within 10 days.', 'delivery'],
  ])('%s is a financial commitment (%s)', (text) => {
    expect(checkDraft(text, facts()).flags).toContain('FINANCIAL_COMMITMENT');
  });

  it('allows a delivery time the business has stated', () => {
    expect(checkDraft('Delivery within 3 weeks of the deposit.', facts()).flags).toEqual([]);
  });

  it('flags a draft that is too long', () => {
    expect(checkDraft('x'.repeat(30), facts({ maxChars: 20 })).flags).toEqual(['LENGTH_EXCEEDED']);
  });

  it('leaves an ordinary, helpful draft alone', () => {
    expect(
      checkDraft(
        'Thank you for your message! Could you tell us the size and colour you have in mind?',
        facts(),
      ).flags,
    ).toEqual([]);
  });
});

describe('escalation', () => {
  it('finds a keyword anywhere in the last message, in any case', () => {
    expect(
      escalationFor('This is a COMPLAINT about my order', ['complaint', 'refund']).flags,
    ).toEqual(['ESCALATION_KEYWORD']);
  });
  it('recognises a request for a person', () => {
    for (const text of [
      'Can I speak to a manager?',
      'I want to talk to a real person',
      'connect me with someone please',
      'human agent please',
    ]) {
      expect(escalationFor(text, []).flags).toContain('ASKED_FOR_PERSON');
    }
  });
  it('leaves an ordinary message alone', () => {
    expect(escalationFor('What colours do you have?', ['refund'])).toEqual({
      flags: [],
      reasons: [],
    });
  });
});
