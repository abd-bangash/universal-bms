import fc from 'fast-check';
import { evaluateCondition, isVisible, type Condition } from './fields';

const ctx = (values: Record<string, unknown> = {}, extra: object = {}) => ({ values, ...extra });

describe('isVisible', () => {
  const custom: Condition = { source: 'field', key: 'size_type', op: 'eq', value: 'custom' };

  it('shows a field without a condition or category scope', () => {
    expect(isVisible({}, ctx())).toBe(true);
    expect(isVisible({ visibleWhen: null }, ctx())).toBe(true);
  });

  it('follows the value of another field (the furniture length/width/height rule)', () => {
    expect(isVisible({ visibleWhen: custom }, ctx({ size_type: 'custom' }))).toBe(true);
    expect(isVisible({ visibleWhen: custom }, ctx({ size_type: 'standard' }))).toBe(false);
    expect(isVisible({ visibleWhen: custom }, ctx())).toBe(false);
  });

  it('can look at product type, category and status', () => {
    expect(
      isVisible(
        { visibleWhen: { source: 'productType', op: 'eq', value: 'STOCKABLE' } },
        ctx({}, { productType: 'STOCKABLE' }),
      ),
    ).toBe(true);
    expect(
      isVisible(
        { visibleWhen: { source: 'productType', op: 'eq', value: 'STOCKABLE' } },
        ctx({}, { productType: 'SERVICE' }),
      ),
    ).toBe(false);
    expect(
      isVisible(
        { visibleWhen: { source: 'status', op: 'in', value: ['draft', 'confirmed'] } },
        ctx({}, { status: 'draft' }),
      ),
    ).toBe(true);
    expect(
      isVisible(
        { visibleWhen: { source: 'categoryId', op: 'neq', value: 'c1' } },
        ctx({}, { categoryId: 'c2' }),
      ),
    ).toBe(true);
  });

  it('applies the category scope of the field', () => {
    expect(isVisible({ categoryId: 'sofas' }, ctx({}, { categoryId: 'sofas' }))).toBe(true);
    expect(isVisible({ categoryId: 'sofas' }, ctx({}, { categoryId: 'beds' }))).toBe(false);
    expect(isVisible({ categoryId: 'sofas' }, ctx())).toBe(false);
  });

  it('evaluates all/any groups, nested', () => {
    const rule: Condition = {
      all: [
        custom,
        {
          any: [
            { source: 'field', key: 'material', op: 'eq', value: 'wood' },
            { source: 'field', key: 'material', op: 'eq', value: 'metal' },
          ],
        },
      ],
    };
    expect(isVisible({ visibleWhen: rule }, ctx({ size_type: 'custom', material: 'metal' }))).toBe(
      true,
    );
    expect(isVisible({ visibleWhen: rule }, ctx({ size_type: 'custom', material: 'glass' }))).toBe(
      false,
    );
    expect(isVisible({ visibleWhen: rule }, ctx({ size_type: 'standard', material: 'wood' }))).toBe(
      false,
    );
    expect(evaluateCondition({}, ctx())).toBe(true);
  });

  it('compares numbers and decimal strings numerically for gt and lt', () => {
    const gt: Condition = { source: 'field', key: 'qty', op: 'gt', value: 5 };
    expect(evaluateCondition(gt, ctx({ qty: '10' }))).toBe(true);
    expect(evaluateCondition(gt, ctx({ qty: 5 }))).toBe(false);
    expect(evaluateCondition(gt, ctx({ qty: 'abc' }))).toBe(false);
    expect(
      evaluateCondition(
        { source: 'field', key: 'qty', op: 'lt', value: '5.5' },
        ctx({ qty: '5.25' }),
      ),
    ).toBe(true);
  });

  it('handles exists, empty values and multi-select arrays', () => {
    const exists: Condition = { source: 'field', key: 'notes', op: 'exists' };
    expect(evaluateCondition(exists, ctx({ notes: 'x' }))).toBe(true);
    for (const empty of [undefined, null, '', []])
      expect(evaluateCondition(exists, ctx({ notes: empty }))).toBe(false);
    expect(
      evaluateCondition(
        { source: 'field', key: 'tags', op: 'eq', value: 'oak' },
        ctx({ tags: ['pine', 'oak'] }),
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { source: 'field', key: 'tags', op: 'neq', value: 'oak' },
        ctx({ tags: ['pine'] }),
      ),
    ).toBe(true);
  });

  it('property: eq and neq are opposites for any value', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.integer(), fc.constant(undefined)),
        fc.string(),
        (actual, expected) => {
          const values = { f: actual };
          const eq = evaluateCondition(
            { source: 'field', key: 'f', op: 'eq', value: expected },
            ctx(values),
          );
          const neq = evaluateCondition(
            { source: 'field', key: 'f', op: 'neq', value: expected },
            ctx(values),
          );
          expect(eq).toBe(!neq);
        },
      ),
      { numRuns: 200 },
    );
  });
});
