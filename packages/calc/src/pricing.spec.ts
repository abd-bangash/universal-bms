import fc from 'fast-check';
import Decimal from 'decimal.js';
import {
  calculateDocument,
  effectiveDiscountPercent,
  PricingError,
  type PricingInput,
} from './pricing';

const D = (v: string) => new Decimal(v);
const sum = (values: string[]) => values.reduce((a, b) => a.plus(b), new Decimal(0));

const base = (over: Partial<PricingInput> = {}): PricingInput => ({
  lines: [{ quantity: '1', unitPrice: '100' }],
  pricesIncludeTax: false,
  currencyDecimals: 2,
  ...over,
});

describe('calculateDocument — worked examples', () => {
  it('tax-exclusive: 2 × 1,000 with 10% off and 17% tax', () => {
    const r = calculateDocument(
      base({
        lines: [
          {
            quantity: '2',
            unitPrice: '1000',
            discount: { type: 'PERCENT', value: '10' },
            taxRate: '0.17',
          },
        ],
      }),
    );
    expect(r.lines[0]).toEqual({
      gross: '2000.00',
      lineDiscountAmount: '200.00',
      allocatedDiscount: '0.00',
      discountAmount: '200.00',
      net: '1800.00',
      netExcludingTax: '1800.00',
      taxAmount: '306.00',
      lineTotal: '2106.00',
    });
    expect(r).toMatchObject({
      subtotal: '2000.00',
      discountAmount: '200.00',
      taxAmount: '306.00',
      roundingAmount: '0.00',
      total: '2106.00',
    });
    expect(r.taxBreakdown).toEqual([
      { rate: '0.17', taxableAmount: '1800.00', taxAmount: '306.00' },
    ]);
  });

  it('tax-inclusive: the price already contains the tax, which is carved out of it', () => {
    const r = calculateDocument(
      base({
        pricesIncludeTax: true,
        lines: [{ quantity: '1', unitPrice: '1170', taxRate: '0.17' }],
      }),
    );
    expect(r.lines[0]).toMatchObject({
      net: '1170.00',
      netExcludingTax: '1000.00',
      taxAmount: '170.00',
      lineTotal: '1170.00',
    });
    expect(r).toMatchObject({ subtotal: '1170.00', taxAmount: '170.00', total: '1170.00' });
  });

  it('rounds half up to the currency decimals at line level and sums the rounded lines', () => {
    const r = calculateDocument(
      base({
        lines: [
          { quantity: '3', unitPrice: '0.335' },
          { quantity: '3', unitPrice: '0.335' },
        ],
        currencyDecimals: 2,
      }),
    );
    expect(r.lines.map((l) => l.gross)).toEqual(['1.01', '1.01']); // 1.005 rounds up
    expect(r.total).toBe('2.02');
    expect(
      calculateDocument(
        base({ currencyDecimals: 0, lines: [{ quantity: '1', unitPrice: '10.5' }] }),
      ).total,
    ).toBe('11');
    expect(
      calculateDocument(
        base({ currencyDecimals: 3, lines: [{ quantity: '1', unitPrice: '1.2345' }] }),
      ).total,
    ).toBe('1.235');
  });

  it('an amount discount is capped at the line, a percent one at 100%, so no line goes below zero', () => {
    const r = calculateDocument(
      base({
        lines: [
          { quantity: '1', unitPrice: '50', discount: { type: 'AMOUNT', value: '80' } },
          { quantity: '1', unitPrice: '40', discount: { type: 'PERCENT', value: '100' } },
        ],
      }),
    );
    expect(r.lines.map((l) => l.lineTotal)).toEqual(['0.00', '0.00']);
    expect(r.total).toBe('0.00');
  });

  it('shares an order discount in proportion to each line and the parts add up exactly', () => {
    const r = calculateDocument(
      base({
        lines: [
          { quantity: '1', unitPrice: '100' },
          { quantity: '1', unitPrice: '200' },
          { quantity: '1', unitPrice: '300' },
        ],
        orderDiscount: { type: 'AMOUNT', value: '100' },
      }),
    );
    expect(r.lines.map((l) => l.allocatedDiscount)).toEqual(['16.67', '33.33', '50.00']);
    expect(sum(r.lines.map((l) => l.allocatedDiscount)).toFixed(2)).toBe('100.00');
    expect(r.orderDiscountAmount).toBe('100.00');
    expect(r.total).toBe('500.00');
    // the order discount is taken after the line discounts
    const stacked = calculateDocument(
      base({
        lines: [
          { quantity: '1', unitPrice: '100', discount: { type: 'PERCENT', value: '50' } },
          { quantity: '1', unitPrice: '50' },
        ],
        orderDiscount: { type: 'PERCENT', value: '10' },
      }),
    );
    expect(stacked.orderDiscountAmount).toBe('10.00');
    expect(stacked.discountAmount).toBe('60.00');
    expect(stacked.total).toBe('90.00');
  });

  it('tax is worked out on the discounted amount, per line, with a breakdown per rate', () => {
    const r = calculateDocument(
      base({
        lines: [
          { quantity: '1', unitPrice: '1000', taxRate: '0.17' },
          { quantity: '1', unitPrice: '500', taxRate: '0.05' },
          { quantity: '2', unitPrice: '100', taxRate: '0.17' },
        ],
        orderDiscount: { type: 'PERCENT', value: '10' },
      }),
    );
    expect(r.taxAmount).toBe('206.10'); // 900 @17% + 450 @5% + 180 @17%
    expect(r.taxBreakdown).toEqual([
      { rate: '0.05', taxableAmount: '450.00', taxAmount: '22.50' },
      { rate: '0.17', taxableAmount: '1080.00', taxAmount: '183.60' },
    ]);
    expect(r.total).toBe('1736.10');
  });

  it('rounds the amount payable in cash to the increment and records the difference (35.7)', () => {
    const r = calculateDocument(
      base({ lines: [{ quantity: '1', unitPrice: '1234' }], cashRoundingIncrement: '5' }),
    );
    expect(r).toMatchObject({ roundingAmount: '1.00', total: '1235.00' });
    expect(
      calculateDocument(
        base({ lines: [{ quantity: '1', unitPrice: '1232.50' }], cashRoundingIncrement: '5' }),
      ).roundingAmount,
    ).toBe('2.50');
    expect(
      calculateDocument(
        base({ lines: [{ quantity: '1', unitPrice: '1233' }], cashRoundingIncrement: '5' }),
      ),
    ).toMatchObject({ roundingAmount: '2.00', total: '1235.00' });
    expect(
      calculateDocument(
        base({ lines: [{ quantity: '1', unitPrice: '1230' }], cashRoundingIncrement: '5' }),
      ).roundingAmount,
    ).toBe('0.00');
    expect(calculateDocument(base({ cashRoundingIncrement: null })).roundingAmount).toBe('0.00');
  });

  it('handles no lines and rejects bad input with the field named', () => {
    expect(calculateDocument(base({ lines: [] }))).toMatchObject({
      subtotal: '0.00',
      total: '0.00',
      lines: [],
      taxBreakdown: [],
    });
    const bad = (over: Partial<PricingInput>, field: string) => {
      try {
        calculateDocument(base(over));
      } catch (err) {
        expect(err).toBeInstanceOf(PricingError);
        expect((err as PricingError).field).toBe(field);
        return;
      }
      throw new Error(`expected a PricingError for ${field}`);
    };
    bad({ lines: [{ quantity: '0', unitPrice: '1' }] }, 'lines[0].quantity');
    bad({ lines: [{ quantity: '1', unitPrice: '-1' }] }, 'lines[0].unitPrice');
    bad({ lines: [{ quantity: '1', unitPrice: 'abc' }] }, 'lines[0].unitPrice');
    bad({ lines: [{ quantity: '1', unitPrice: '1', taxRate: '1.5' }] }, 'lines[0].taxRate');
    bad(
      { lines: [{ quantity: '1', unitPrice: '1', discount: { type: 'PERCENT', value: '101' } }] },
      'lines[0].discount.value',
    );
    bad(
      { lines: [{ quantity: '1', unitPrice: '1', discount: { type: 'AMOUNT', value: '-1' } }] },
      'lines[0].discount.value',
    );
    bad({ orderDiscount: { type: 'PERCENT', value: '150' } }, 'orderDiscount.value');
    bad({ currencyDecimals: 9 }, 'currencyDecimals');
    bad({ cashRoundingIncrement: '0' }, 'cashRoundingIncrement');
  });

  it("reports each line's effective discount percentage, including its share of the order discount", () => {
    const r = calculateDocument(
      base({
        lines: [{ quantity: '1', unitPrice: '200', discount: { type: 'PERCENT', value: '10' } }],
        orderDiscount: { type: 'AMOUNT', value: '20' },
      }),
    );
    expect(r.lines[0]).toMatchObject({ discountAmount: '40.00' });
    expect(effectiveDiscountPercent(r.lines[0]!)).toBe('20');
    expect(effectiveDiscountPercent({ gross: '0.00', discountAmount: '0.00' })).toBe('0');
  });
});

// Property 14 — Pricing arithmetic. Validates 35.3, 35.5, 35.6, 35.10.
describe('Property 14 — pricing arithmetic', () => {
  const money = (decimals: number) =>
    fc
      .integer({ min: 0, max: 5_000_000 })
      .map((n) => new Decimal(n).div(new Decimal(10).pow(decimals)).toFixed(decimals));
  const discount = (decimals: number) =>
    fc.option(
      fc.oneof(
        fc.record({
          type: fc.constant('PERCENT' as const),
          value: fc.integer({ min: 0, max: 10_000 }).map((n) => (n / 100).toFixed(2)),
        }),
        fc.record({ type: fc.constant('AMOUNT' as const), value: money(decimals) }),
      ),
      { nil: undefined },
    );
  const line = (decimals: number) =>
    fc.record({
      quantity: fc.integer({ min: 1, max: 20_000 }).map((n) => (n / 1000).toFixed(3)),
      unitPrice: money(decimals),
      discount: discount(decimals),
      taxRate: fc.constantFrom('0', '0.05', '0.1', '0.17', '0.2', '0.075'),
    });
  const input = fc.integer({ min: 0, max: 3 }).chain((decimals) =>
    fc.record({
      lines: fc.array(line(decimals), { minLength: 1, maxLength: 8 }),
      orderDiscount: discount(decimals),
      pricesIncludeTax: fc.boolean(),
      currencyDecimals: fc.constant(decimals),
      cashRoundingIncrement: fc.option(fc.constantFrom('0.05', '0.5', '1', '5', '10'), {
        nil: undefined,
      }),
    }),
  );

  it('total = Σ line totals + rounding, the order discount is shared exactly, and nothing goes negative', () => {
    fc.assert(
      fc.property(input, (i) => {
        const r = calculateDocument(i as PricingInput);
        const decimals = i.currencyDecimals;
        expect(
          sum(r.lines.map((l) => l.lineTotal))
            .plus(r.roundingAmount)
            .toFixed(decimals),
        ).toBe(r.total);
        expect(sum(r.lines.map((l) => l.allocatedDiscount)).toFixed(decimals)).toBe(
          r.orderDiscountAmount,
        );
        expect(sum(r.lines.map((l) => l.discountAmount)).toFixed(decimals)).toBe(r.discountAmount);
        expect(sum(r.lines.map((l) => l.gross)).toFixed(decimals)).toBe(r.subtotal);
        expect(sum(r.lines.map((l) => l.taxAmount)).toFixed(decimals)).toBe(r.taxAmount);
        for (const l of r.lines) {
          expect(D(l.lineTotal).gte(0)).toBe(true);
          expect(D(l.net).gte(0)).toBe(true);
          expect(D(l.taxAmount).gte(0)).toBe(true);
          expect(D(l.discountAmount).lte(l.gross)).toBe(true);
          expect(D(l.allocatedDiscount).gte(0)).toBe(true);
          expect(D(l.netExcludingTax).gte(0)).toBe(true);
          // every amount is a whole number of the currency's smallest unit
          for (const v of [l.gross, l.discountAmount, l.net, l.taxAmount, l.lineTotal])
            expect(new Decimal(v).decimalPlaces()).toBeLessThanOrEqual(decimals);
        }
        // the grand total is never below zero (rounding to a cash increment cannot push it under)
        expect(D(r.total).gte(0)).toBe(true);
        // tax breakdown adds up to the tax and the taxable amounts
        expect(sum(r.taxBreakdown.map((b) => b.taxAmount)).toFixed(decimals)).toBe(r.taxAmount);
        expect(sum(r.taxBreakdown.map((b) => b.taxableAmount)).toFixed(decimals)).toBe(
          sum(r.lines.map((l) => l.netExcludingTax)).toFixed(decimals),
        );
      }),
      { numRuns: 300 },
    );
  });

  it('tax-inclusive and tax-exclusive pricing of the same net agree on the net amount (within one unit of rounding)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.constantFrom('0', '0.05', '0.1', '0.17', '0.2'),
        (decimals, cents, taxRate) => {
          const price = new Decimal(cents).div(new Decimal(10).pow(decimals)).toFixed(decimals);
          const exclusive = calculateDocument({
            lines: [{ quantity: '1', unitPrice: price, taxRate }],
            pricesIncludeTax: false,
            currencyDecimals: decimals,
          });
          const gross = exclusive.lines[0]!.lineTotal; // net + tax: what a customer pays
          const inclusive = calculateDocument({
            lines: [{ quantity: '1', unitPrice: gross, taxRate }],
            pricesIncludeTax: true,
            currencyDecimals: decimals,
          });
          const unit = new Decimal(10).pow(-decimals);
          expect(inclusive.total).toBe(exclusive.total);
          expect(
            D(inclusive.lines[0]!.netExcludingTax)
              .minus(exclusive.lines[0]!.netExcludingTax)
              .abs()
              .lte(unit),
          ).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('allocating an order discount never changes who pays what in total: removing it adds back exactly the discount', () => {
    fc.assert(
      fc.property(input, (i) => {
        const withDiscount = calculateDocument({
          ...i,
          cashRoundingIncrement: undefined,
        } as PricingInput);
        const without = calculateDocument({
          ...i,
          orderDiscount: undefined,
          cashRoundingIncrement: undefined,
        } as PricingInput);
        if (!i.pricesIncludeTax) {
          // exclusive: tax moves with the discount, so compare the pre-tax net
          expect(
            sum(without.lines.map((l) => l.netExcludingTax))
              .minus(sum(withDiscount.lines.map((l) => l.netExcludingTax)))
              .toFixed(i.currencyDecimals),
          ).toBe(withDiscount.orderDiscountAmount);
        } else {
          expect(
            sum(without.lines.map((l) => l.lineTotal))
              .minus(sum(withDiscount.lines.map((l) => l.lineTotal)))
              .toFixed(i.currencyDecimals),
          ).toBe(withDiscount.orderDiscountAmount);
        }
      }),
      { numRuns: 200 },
    );
  });
});
