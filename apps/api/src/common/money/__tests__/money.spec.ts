import fc from 'fast-check';
import {
  D,
  isDecimalString,
  roundHalfUp,
  sum,
  toDecimal,
  toJsonString,
  toStorageString,
} from '../money';

const decimalString = fc
  .tuple(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.integer({ min: 0, max: 9999 }))
  .map(([whole, frac]) => `${whole}.${String(frac).padStart(4, '0')}`);

describe('money helpers', () => {
  it('avoids binary floating point errors', () => {
    expect(toJsonString(toDecimal('0.1').plus(toDecimal('0.2')))).toBe('0.3');
    expect(Number('0.1') + Number('0.2')).not.toBe(0.3); // the problem this module prevents
  });

  it('rounds half up, including negatives away from zero', () => {
    expect(toJsonString(roundHalfUp(toDecimal('2.345'), 2))).toBe('2.35');
    expect(toJsonString(roundHalfUp(toDecimal('2.344'), 2))).toBe('2.34');
    expect(toJsonString(roundHalfUp(toDecimal('-2.345'), 2))).toBe('-2.35');
  });

  it('refuses JavaScript numbers and malformed text', () => {
    expect(() => toDecimal(1.5 as unknown as string)).toThrow(TypeError);
    expect(() => toDecimal('1e3')).toThrow(TypeError);
    expect(() => toDecimal('abc')).toThrow(TypeError);
    expect(isDecimalString('12.50')).toBe(true);
    expect(isDecimalString(12.5)).toBe(false);
  });

  it('formats storage values with four decimals and never an exponent', () => {
    expect(toStorageString(toDecimal('12.5'))).toBe('12.5000');
    expect(toJsonString(new D('0.0000001'))).toBe('0.0000001');
  });

  it('property: parse then print is the identity for 4-decimal strings', () => {
    fc.assert(
      fc.property(decimalString, (s) => {
        expect(toStorageString(toDecimal(s))).toBe(s === '-0.0000' ? '0.0000' : s);
      }),
      { numRuns: 200 },
    );
  });

  it('property: sums are order independent and exact', () => {
    fc.assert(
      fc.property(fc.array(decimalString, { maxLength: 30 }), (values) => {
        const forward = sum(values);
        const backward = sum([...values].reverse());
        expect(forward.equals(backward)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('property: rounding is idempotent and within half a unit', () => {
    fc.assert(
      fc.property(decimalString, fc.integer({ min: 0, max: 3 }), (s, places) => {
        const once = roundHalfUp(toDecimal(s), places);
        expect(roundHalfUp(once, places).equals(once)).toBe(true);
        const error = once.minus(toDecimal(s)).abs();
        expect(error.lte(new D(0.5).div(new D(10).pow(places)))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
