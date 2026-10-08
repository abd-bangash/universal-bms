import Decimal from 'decimal.js';

/** Isolated Decimal class: half-up rounding, generous precision. Never use number arithmetic on money. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_PATTERN.test(value);
}

/**
 * Converts a decimal string, Decimal or Prisma.Decimal to our Decimal.
 * JavaScript numbers are rejected on purpose: they have already lost precision.
 */
export function toDecimal(value: string | { toString(): string }): Dec {
  if (typeof value === 'number') {
    throw new TypeError('Numbers are not allowed for money or quantities; use a decimal string');
  }
  const text = value.toString();
  if (!isDecimalString(text)) {
    throw new TypeError('Not a decimal value');
  }
  return new D(text);
}

export function roundHalfUp(value: Dec, decimals: number): Dec {
  return value.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
}

/** JSON representation: a plain decimal string without exponent. */
export function toJsonString(value: Dec): string {
  return value.toFixed();
}

/** Money is stored as Decimal(18,4); quantities too (design D8). */
export function toStorageString(value: Dec): string {
  return roundHalfUp(value, 4).toFixed(4);
}

export function sum(values: Array<string | Dec>): Dec {
  return values.reduce<Dec>(
    (acc, v) => acc.plus(typeof v === 'string' ? toDecimal(v) : v),
    new D(0),
  );
}
