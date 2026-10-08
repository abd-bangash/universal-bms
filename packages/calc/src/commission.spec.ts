import fc from 'fast-check';
import Decimal from 'decimal.js';
import {
  calculateCommissions,
  commissionAmount,
  commissionBase,
  selectRule,
  unsplitAmount,
  type CommissionLineInput,
  type CommissionRuleInput,
} from './commission';

let seq = 0;
const rule = (over: Partial<CommissionRuleInput> = {}): CommissionRuleInput => ({
  id: `r${++seq}`,
  calcType: 'PERCENTAGE',
  rate: '5',
  baseType: 'NET_SALES',
  scope: 'ALL',
  scopeId: null,
  salespersonId: null,
  priority: 0,
  createdAt: 1000 + seq,
  ...over,
});
const line = (over: Partial<CommissionLineInput> = {}): CommissionLineInput => ({
  key: 'l1',
  lineNo: 1,
  productId: 'p1',
  categoryIds: ['c-child', 'c-parent'],
  quantity: '2',
  unitPrice: '100',
  netAmount: '180',
  costPrice: '60',
  ...over,
});

describe('commission base (41.5)', () => {
  it('net sales is the line after discounts, before tax', () => {
    expect(commissionBase('NET_SALES', line())).toBe('180');
  });
  it('gross sales is quantity times the unit price, before discounts', () => {
    expect(commissionBase('GROSS_SALES', line())).toBe('200');
  });
  it('gross profit is net sales minus cost, and treats an unknown cost as zero', () => {
    expect(commissionBase('GROSS_PROFIT', line())).toBe('60');
    expect(commissionBase('GROSS_PROFIT', line({ costPrice: null }))).toBe('180');
  });
  it('a loss gives a base of zero, never a negative commission', () => {
    expect(commissionBase('GROSS_PROFIT', line({ costPrice: '500' }))).toBe('0');
  });
});

describe('commission amount (14.1)', () => {
  it('percentage of the base, fixed per unit, and fixed per order', () => {
    const rounded = (r: Parameters<typeof commissionAmount>[0]) =>
      commissionAmount(r, '180', '2', '100', 2);
    expect(rounded({ calcType: 'PERCENTAGE', rate: '12.5' })).toBe('22.50');
    expect(rounded({ calcType: 'FIXED_PER_UNIT', rate: '7' })).toBe('14.00');
    expect(rounded({ calcType: 'FIXED_PER_ORDER', rate: '40' })).toBe('40.00');
  });
  it('rounds half up to the currency decimals, after applying the share', () => {
    // 3.5% of 100.10 = 3.5035; 50% share = 1.75175
    expect(commissionAmount({ calcType: 'PERCENTAGE', rate: '3.5' }, '100.10', '1', '50', 2)).toBe(
      '1.75',
    );
    expect(commissionAmount({ calcType: 'PERCENTAGE', rate: '5' }, '10.10', '1', '100', 2)).toBe(
      '0.51', // 0.505 rounds up
    );
    expect(commissionAmount({ calcType: 'PERCENTAGE', rate: '5' }, '10.10', '1', '100', 0)).toBe(
      '1',
    );
  });
});

describe('rule precedence (41.4)', () => {
  const bySales = rule({ salespersonId: 'u1', scope: 'ALL', priority: 0 });
  const product = rule({ scope: 'PRODUCT', scopeId: 'p1' });
  const category = rule({ scope: 'CATEGORY', scopeId: 'c-parent' });
  const orderType = rule({ scope: 'ORDER_TYPE', scopeId: 'STANDARD' });
  const all = rule();
  const pick = (rules: CommissionRuleInput[], who = 'u1') =>
    selectRule(rules, line(), 'STANDARD', who)?.id;

  it("a salesperson's own rule beats every general rule, even a product rule", () => {
    expect(pick([all, orderType, category, product, bySales])).toBe(bySales.id);
  });
  it('among general rules: product, then category, then order type, then all', () => {
    expect(pick([all, orderType, category, product])).toBe(product.id);
    expect(pick([all, orderType, category])).toBe(category.id);
    expect(pick([all, orderType])).toBe(orderType.id);
    expect(pick([all])).toBe(all.id);
  });
  it("a salesperson's product rule beats their all-products rule", () => {
    const own = rule({ salespersonId: 'u1', scope: 'PRODUCT', scopeId: 'p1' });
    expect(pick([bySales, own])).toBe(own.id);
  });
  it('then the highest priority, then the most recently created', () => {
    const low = rule({ priority: 1 });
    const high = rule({ priority: 5 });
    expect(pick([low, high])).toBe(high.id);
    const older = rule({ priority: 5, createdAt: 1 });
    const newer = rule({ priority: 5, createdAt: 2 });
    expect(pick([older, newer])).toBe(newer.id);
    expect(pick([newer, older])).toBe(newer.id);
  });
  it('ignores rules that belong to someone else or point at other things', () => {
    const theirs = rule({ salespersonId: 'u2' });
    const otherProduct = rule({ scope: 'PRODUCT', scopeId: 'p9' });
    const otherCategory = rule({ scope: 'CATEGORY', scopeId: 'c-other' });
    expect(pick([theirs, otherProduct, otherCategory])).toBeUndefined();
    expect(pick([theirs, all])).toBe(all.id);
    expect(pick([theirs], 'u2')).toBe(theirs.id);
  });
  it('a category rule on a parent category applies to products in its children', () => {
    expect(pick([category])).toBe(category.id);
  });
  it('an order-type rule only applies to that type of order', () => {
    expect(selectRule([orderType], line(), 'POS', 'u1')).toBeNull();
  });
});

describe('calculateCommissions', () => {
  const run = (over: Partial<Parameters<typeof calculateCommissions>[0]> = {}) =>
    calculateCommissions({
      rules: [rule({ rate: '10' })],
      lines: [line()],
      salespeople: [{ userId: 'u1', sharePercent: '100' }],
      orderType: 'STANDARD',
      currencyDecimals: 2,
      ...over,
    });

  it('makes one row per salesperson and line, none when no rule matches', () => {
    expect(run()).toEqual([
      expect.objectContaining({
        salespersonId: 'u1',
        lineKey: 'l1',
        calculationBase: '180',
        amount: '18.00',
      }),
    ]);
    expect(run({ rules: [] })).toEqual([]);
  });

  it('splits by share and judges each salesperson on their own rules', () => {
    const rows = run({
      rules: [rule({ rate: '10' }), rule({ rate: '20', salespersonId: 'u2' })],
      salespeople: [
        { userId: 'u1', sharePercent: '60' },
        { userId: 'u2', sharePercent: '40' },
      ],
    });
    expect(rows.map((r) => [r.salespersonId, r.amount])).toEqual([
      ['u1', '10.80'], // 10% of 180 × 60%
      ['u2', '14.40'], // 20% of 180 × 40%
    ]);
  });

  it('a fixed amount per order is paid once per salesperson, on the first line that picks it', () => {
    const perOrder = rule({ calcType: 'FIXED_PER_ORDER', rate: '50' });
    const rows = run({
      rules: [perOrder],
      lines: [
        line({ key: 'a', lineNo: 2 }),
        line({ key: 'b', lineNo: 1 }),
        line({ key: 'c', lineNo: 3 }),
      ],
    });
    expect(rows.map((r) => [r.lineKey, r.amount])).toEqual([['b', '50.00']]);
  });

  it('different lines can pick different rules', () => {
    const sofaRule = rule({ scope: 'PRODUCT', scopeId: 'sofa', rate: '20' });
    const rows = run({
      rules: [rule({ rate: '10' }), sofaRule],
      lines: [line({ key: 'x', lineNo: 1, productId: 'sofa' }), line({ key: 'y', lineNo: 2 })],
    });
    expect(rows.map((r) => [r.lineKey, r.amount])).toEqual([
      ['x', '36.00'],
      ['y', '18.00'],
    ]);
  });

  it('leaves out rows that come to nothing', () => {
    expect(run({ rules: [rule({ rate: '0' })] })).toEqual([]);
  });
});

describe('Property 8 — commission arithmetic (14.1, 14.2, 41.3 to 41.5)', () => {
  const money = fc.integer({ min: 0, max: 100_000_000 }).map((n) => (n / 100).toFixed(2));
  const rate = fc.integer({ min: 0, max: 10_000 }).map((n) => (n / 100).toString());
  const quantity = fc.integer({ min: 1, max: 500 }).map(String);
  const decimals = fc.constantFrom(0, 2, 3);
  const calcType = fc.constantFrom('PERCENTAGE', 'FIXED_PER_ORDER', 'FIXED_PER_UNIT' as const);
  const baseType = fc.constantFrom('NET_SALES', 'GROSS_SALES', 'GROSS_PROFIT' as const);

  it('equals the formula of the rule type and base, times the share, rounded half-up', () => {
    fc.assert(
      fc.property(
        calcType,
        baseType,
        rate,
        money,
        quantity,
        money,
        money,
        fc.integer({ min: 1, max: 10_000 }).map((n) => (n / 100).toString()),
        decimals,
        (type, base, r, unitPrice, qty, net, cost, share, dp) => {
          const l = line({ quantity: qty, unitPrice, netAmount: net, costPrice: cost });
          const rl = rule({ calcType: type, baseType: base, rate: r });
          const b = commissionBase(base, l);
          const expected = unsplitAmount(rl, b, qty)
            .mul(share)
            .div(100)
            .toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
          expect(commissionAmount(rl, b, qty, share, dp)).toBe(expected.toFixed(dp));
          expect(new Decimal(commissionAmount(rl, b, qty, share, dp)).gte(0)).toBe(true);
        },
      ),
    );
  });

  it('shares of a line never add up to more than the unsplit amount by more than one minor unit per salesperson', () => {
    fc.assert(
      fc.property(
        calcType,
        rate,
        money,
        quantity,
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 6 }),
        decimals,
        (type, r, net, qty, weights, dp) => {
          const total = weights.reduce((a, b) => a + b, 0);
          // shares that total exactly 100 (the last takes the remainder)
          const shares: string[] = [];
          let used = new Decimal(0);
          weights.forEach((w, i) => {
            const share =
              i === weights.length - 1
                ? new Decimal(100).minus(used)
                : new Decimal(w).mul(100).div(total).toDecimalPlaces(4);
            used = used.plus(share);
            shares.push(share.toFixed(4));
          });
          const rl = rule({ calcType: type, rate: r });
          const l = line({ quantity: qty, unitPrice: '1', netAmount: net });
          const b = commissionBase('NET_SALES', l);
          const unsplit = unsplitAmount(rl, b, qty);
          const sum = shares.reduce(
            (acc, s) => acc.plus(commissionAmount(rl, b, qty, s, dp)),
            new Decimal(0),
          );
          const unit = new Decimal(10).pow(-dp);
          expect(sum.minus(unsplit.toDecimalPlaces(dp)).lte(unit.mul(weights.length))).toBe(true);
          // and never meaningfully more than the whole
          expect(sum.lte(unsplit.plus(unit.mul(weights.length)))).toBe(true);
        },
      ),
    );
  });

  it('the rule chosen does not depend on the order the rules are listed in', () => {
    const rules = fc.array(
      fc.record({
        scope: fc.constantFrom('ALL', 'PRODUCT', 'CATEGORY', 'ORDER_TYPE' as const),
        salespersonId: fc.constantFrom(null, 'u1', 'u2'),
        priority: fc.integer({ min: 0, max: 3 }),
        createdAt: fc.integer({ min: 0, max: 3 }),
      }),
      { minLength: 1, maxLength: 8 },
    );
    fc.assert(
      fc.property(rules, fc.integer({ min: 0, max: 1000 }), (specs, seed) => {
        const list = specs.map((s, i) =>
          rule({
            id: `x${i}`,
            scope: s.scope,
            scopeId:
              s.scope === 'ALL'
                ? null
                : s.scope === 'PRODUCT'
                  ? 'p1'
                  : s.scope === 'CATEGORY'
                    ? 'c-parent'
                    : 'STANDARD',
            salespersonId: s.salespersonId,
            priority: s.priority,
            createdAt: s.createdAt,
          }),
        );
        const shuffled = [...list].sort(
          (a, b) => ((a.id.charCodeAt(1) * seed) % 7) - ((b.id.charCodeAt(1) * seed) % 7),
        );
        expect(selectRule(shuffled, line(), 'STANDARD', 'u1')?.id).toBe(
          selectRule(list, line(), 'STANDARD', 'u1')?.id,
        );
      }),
    );
  });
});
