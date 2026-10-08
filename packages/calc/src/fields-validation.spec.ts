import fc from 'fast-check';
import {
  buildFieldSnapshot,
  validateCustomFields,
  type FieldDefinitionLike,
  type FieldValueType,
} from './fields';

const UNITS = { ft: 'length', in: 'length', cm: 'length', kg: 'weight' };
const OPTIONS = [
  { key: 'oak', label: 'Oak' },
  { key: 'teak', label: 'Teak' },
  { key: 'pine', label: 'Pine' },
];

const def = (
  type: FieldValueType,
  extra: Partial<FieldDefinitionLike> = {},
): FieldDefinitionLike => ({
  key: 'f',
  label: 'Field',
  type,
  options: OPTIONS,
  unitDimension: 'length',
  defaultUnit: 'ft',
  active: true,
  ...extra,
});

const validate = (d: FieldDefinitionLike, value: unknown) =>
  validateCustomFields([d], { f: value }, { values: {}, units: UNITS });

/** Arbitrary valid value per type, in the stored shape of design.md. */
const decimal = (intDigits: number, maxFraction: number) =>
  fc
    .tuple(
      fc.integer({ min: 0, max: 10 ** Math.min(intDigits, 12) - 1 }),
      fc.option(fc.integer({ min: 0, max: 10 ** maxFraction - 1 }), { nil: undefined }),
    )
    .map(([i, f]) =>
      f === undefined ? String(i) : `${i}.${String(f).padStart(maxFraction, '0')}`,
    );

const validValue: Record<FieldValueType, fc.Arbitrary<unknown>> = {
  TEXT: fc.string({ maxLength: 200 }).filter((s) => s !== ''),
  NUMBER: fc.tuple(fc.boolean(), decimal(12, 8)).map(([neg, d]) => (neg ? `-${d}` : d)),
  CURRENCY: decimal(12, 4),
  DATE: fc
    .date({ min: new Date('1970-01-01'), max: new Date('2100-12-31'), noInvalidDate: true })
    .map((d) => d.toISOString().slice(0, 10)),
  BOOLEAN: fc.boolean(),
  DROPDOWN: fc.constantFrom(...OPTIONS.map((o) => o.key)),
  MULTI_SELECT: fc.subarray(
    OPTIONS.map((o) => o.key),
    { minLength: 1 },
  ),
  MEASUREMENT: fc.record({
    value: decimal(12, 8),
    unit: fc.constantFrom('ft', 'in', 'cm'),
  }),
  IMAGE: fc.string({ minLength: 1, maxLength: 30 }),
  REFERENCE: fc.record({
    entityType: fc.constantFrom('CUSTOMER', 'PRODUCT'),
    id: fc.string({ minLength: 1, maxLength: 30 }),
  }),
};

const TYPES = Object.keys(validValue) as FieldValueType[];

describe('Property 11 — custom field round-trip and rejection of invalid values', () => {
  it.each(TYPES)('%s: a valid value validates and comes back equal, and is stable', (type) => {
    fc.assert(
      fc.property(validValue[type], (value) => {
        const first = validate(def(type), value);
        expect(first).toEqual({ ok: true, values: { f: value } });
        // store → read → validate again: unchanged
        const second = validate(def(type), first.ok ? first.values.f : undefined);
        expect(second).toEqual(first);
      }),
      { numRuns: 100 },
    );
  });

  const invalid: Array<[FieldValueType, unknown[]]> = [
    ['TEXT', [1, true, {}, 'x'.repeat(2001)]],
    ['NUMBER', ['abc', '1e5', '1.', '.5', '1,5', true, {}, NaN, '1.123456789']],
    ['CURRENCY', ['-1', '1.12345', 'abc', true, {}]],
    ['DATE', ['2024-02-30', '24-01-01', '2024-13-01', 'yesterday', 20240101, true]],
    ['BOOLEAN', ['true', 1, 0, {}]],
    ['DROPDOWN', ['walnut', 1, true, {}]],
    ['MULTI_SELECT', ['oak', ['walnut'], ['oak', 'oak'], [1], {}]],
    [
      'MEASUREMENT',
      [
        { value: 'x', unit: 'ft' },
        { value: '1', unit: 'kg' },
        { value: '1', unit: 'parsec' },
        { unit: 'ft' },
        '5 ft',
      ],
    ],
    ['IMAGE', [1, {}, true]],
    ['REFERENCE', [{ id: 'x' }, { entityType: 'CUSTOMER' }, 'x', { entityType: 1, id: 2 }]],
  ];
  it.each(invalid)('%s: invalid values are rejected with a field-level error', (type, values) => {
    for (const value of values) {
      const result = validate(def(type), value);
      expect({ value, ok: result.ok }).toEqual({ value, ok: false });
      if (!result.ok) expect(result.errors.f?.length).toBeGreaterThan(0);
    }
  });

  it('property: arbitrary non-matching values are rejected for typed fields', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        for (const type of ['BOOLEAN', 'DROPDOWN', 'DATE'] as const) {
          const result = validate(def(type), value);
          if (result.ok && 'f' in result.values) {
            // accepted only when it genuinely is a member of the type's value space
            if (type === 'BOOLEAN') expect(typeof value).toBe('boolean');
            if (type === 'DROPDOWN') expect(OPTIONS.map((o) => o.key)).toContain(value);
            if (type === 'DATE') expect(String(value)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          }
        }
      }),
    );
  });
});

describe('validateCustomFields rules', () => {
  it('rejects unknown keys and writes to deactivated fields', () => {
    const defs = [def('TEXT', { key: 'a' }), def('TEXT', { key: 'old', active: false })];
    const result = validateCustomFields(defs, { zzz: 'x', old: 'y' }, { values: {} });
    expect(result).toEqual({
      ok: false,
      errors: { zzz: ['is not a defined field'], old: ['is deactivated'] },
    });
  });

  it('keeps stored values of deactivated fields (26.6) and drops nothing else', () => {
    const defs = [def('TEXT', { key: 'a' }), def('TEXT', { key: 'old', active: false })];
    const result = validateCustomFields(
      defs,
      { a: 'new' },
      { values: {}, existing: { old: 'kept', a: 'prev' } },
    );
    expect(result).toEqual({ ok: true, values: { a: 'new', old: 'kept' } });
  });

  it('requires only visible fields (26.4) and drops hidden ones', () => {
    const length = def('MEASUREMENT', {
      key: 'length',
      required: true,
      visibleWhen: { source: 'field', key: 'size_type', op: 'eq', value: 'custom' },
    });
    const sizeType = def('DROPDOWN', {
      key: 'size_type',
      options: [
        { key: 'standard', label: 'Standard' },
        { key: 'custom', label: 'Custom' },
      ],
    });
    const defs = [sizeType, length];
    expect(
      validateCustomFields(defs, { size_type: 'standard' }, { values: {}, units: UNITS }),
    ).toEqual({
      ok: true,
      values: { size_type: 'standard' },
    });
    expect(
      validateCustomFields(
        defs,
        { size_type: 'standard', length: { value: '5', unit: 'ft' } },
        { values: {}, units: UNITS },
      ),
    ).toEqual({ ok: true, values: { size_type: 'standard' } });
    expect(
      validateCustomFields(defs, { size_type: 'custom' }, { values: {}, units: UNITS }),
    ).toEqual({
      ok: false,
      errors: { length: ['is required'] },
    });
    expect(
      validateCustomFields(
        defs,
        { size_type: 'custom', length: { value: 5, unit: 'ft' } },
        { values: {}, units: UNITS },
      ),
    ).toEqual({ ok: true, values: { size_type: 'custom', length: { value: '5', unit: 'ft' } } });
  });

  it('applies defaults, the default unit, and treats null/empty as clearing an optional field', () => {
    const defs = [
      def('TEXT', { key: 'a', defaultValue: 'hello' }),
      def('MEASUREMENT', { key: 'm' }),
      def('TEXT', { key: 'b' }),
      def('TEXT', { key: 'req', required: true }),
    ];
    const result = validateCustomFields(
      defs,
      { m: { value: '2' }, b: null, req: 'x' },
      { values: {}, units: UNITS, existing: { b: 'old' } },
    );
    expect(result).toEqual({
      ok: true,
      values: { a: 'hello', m: { value: '2', unit: 'ft' }, req: 'x' },
    });
    expect(validateCustomFields(defs, { req: '' }, { values: {} })).toMatchObject({
      ok: false,
      errors: { req: ['is required'] },
    });
  });

  it('honours Category scope', () => {
    const scoped = def('TEXT', { key: 's', required: true, categoryId: 'sofas' });
    expect(validateCustomFields([scoped], {}, { values: {}, categoryId: 'beds' })).toEqual({
      ok: true,
      values: {},
    });
    expect(validateCustomFields([scoped], {}, { values: {}, categoryId: 'sofas' }).ok).toBe(false);
    // a sub-category inherits the field of its parent Category (Requirement 6.5)
    expect(
      validateCustomFields(
        [scoped],
        {},
        { values: {}, categoryId: 'corner', categoryPath: ['sofas'] },
      ).ok,
    ).toBe(false);
  });
});

describe('buildFieldSnapshot (26.8)', () => {
  const defs = [
    def('MEASUREMENT', { key: 'length', label: 'Length', sortOrder: 2 }),
    def('DROPDOWN', { key: 'wood', label: 'Wood', sortOrder: 1 }),
    def('MULTI_SELECT', { key: 'finish', label: 'Finish', sortOrder: 3 }),
    def('BOOLEAN', { key: 'cushions', label: 'Cushions', sortOrder: 4 }),
    def('TEXT', { key: 'note', label: 'Note', sortOrder: 5 }),
  ];

  it('freezes label, value and unit, ordered, with option labels', () => {
    const snapshot = buildFieldSnapshot(defs, {
      length: { value: '6.5', unit: 'ft' },
      wood: 'teak',
      finish: ['oak', 'pine'],
      cushions: false,
      note: 'Delivery to 2nd floor',
      unknown: 'ignored',
    });
    expect(snapshot).toEqual([
      { key: 'wood', label: 'Wood', value: 'Teak', unit: null },
      { key: 'length', label: 'Length', value: '6.5', unit: 'ft' },
      { key: 'finish', label: 'Finish', value: 'Oak, Pine', unit: null },
      { key: 'cushions', label: 'Cushions', value: 'No', unit: null },
      { key: 'note', label: 'Note', value: 'Delivery to 2nd floor', unit: null },
    ]);
  });

  it('is unaffected by later definition changes, and skips empty values', () => {
    const snapshot = buildFieldSnapshot(defs, { wood: 'teak', note: '' });
    const renamed = defs.map((d) => (d.key === 'wood' ? { ...d, label: 'Timber' } : d));
    expect(buildFieldSnapshot(renamed, { wood: 'teak' })[0]?.label).toBe('Timber');
    expect(snapshot).toEqual([{ key: 'wood', label: 'Wood', value: 'Teak', unit: null }]);
  });
});
