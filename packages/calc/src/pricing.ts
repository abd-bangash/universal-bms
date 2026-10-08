import Decimal from 'decimal.js';

/**
 * One calculation for quotations, orders, POS sales and invoices, in the browser and on the server
 * (Requirement 35.10). Amounts go in and come out as decimal STRINGS; nothing here uses binary
 * floating point (Requirement 54.3). Rounding is half-up to the currency's decimal places.
 */
const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type Dec = InstanceType<typeof Dec>;

export type DiscountType = 'AMOUNT' | 'PERCENT';

export interface DiscountInput {
  type: DiscountType;
  value: string;
}

export interface PricingLineInput {
  quantity: string;
  unitPrice: string;
  discount?: DiscountInput | null;
  /** A fraction such as "0.1700" for 17 percent; "0" when tax is off. */
  taxRate?: string;
}

export interface PricingInput {
  lines: readonly PricingLineInput[];
  orderDiscount?: DiscountInput | null;
  /** Prices already contain tax (the Workspace setting `tax.pricesIncludeTax`). */
  pricesIncludeTax: boolean;
  currencyDecimals: number;
  /** For a cash payment: the amount payable is rounded to a multiple of this (Requirement 35.7). */
  cashRoundingIncrement?: string | null;
}

export interface PricingLineResult {
  /** quantity × unit price, rounded. */
  gross: string;
  /** This line's own discount, rounded. */
  lineDiscountAmount: string;
  /** This line's share of the order discount. */
  allocatedDiscount: string;
  /** Line discount plus allocated order discount (what is stored on the line). */
  discountAmount: string;
  /** gross − discountAmount: the price basis, tax-inclusive when prices include tax. */
  net: string;
  /** The amount before tax, whichever way prices are entered. */
  netExcludingTax: string;
  taxAmount: string;
  lineTotal: string;
}

export interface TaxBreakdownEntry {
  rate: string;
  taxableAmount: string;
  taxAmount: string;
}

export interface PricingResult {
  lines: PricingLineResult[];
  /** Σ gross. */
  subtotal: string;
  /** Σ line discounts and the order discount. */
  discountAmount: string;
  orderDiscountAmount: string;
  taxAmount: string;
  /** Rounding to the cash increment; zero when none applies. */
  roundingAmount: string;
  /** Σ line totals + rounding. */
  total: string;
  taxBreakdown: TaxBreakdownEntry[];
}

export class PricingError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;

function parse(
  value: string | undefined,
  field: string,
  options: { min?: Dec; max?: Dec } = {},
): Dec {
  if (typeof value !== 'string' || !DECIMAL_TEXT.test(value.trim())) {
    throw new PricingError(field, `${field} must be a decimal string`);
  }
  const d = new Dec(value.trim());
  if (options.min && d.lt(options.min)) throw new PricingError(field, `${field} is too small`);
  if (options.max && d.gt(options.max)) throw new PricingError(field, `${field} is too large`);
  return d;
}

const ZERO = new Dec(0);
const round = (d: Dec, decimals: number): Dec => d.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);

function discountAmount(
  discount: DiscountInput | null | undefined,
  base: Dec,
  field: string,
  decimals: number,
): Dec {
  if (!discount) return ZERO;
  if (discount.type === 'PERCENT') {
    const pct = parse(discount.value, `${field}.value`, { min: ZERO, max: new Dec(100) });
    return Dec.min(round(base.mul(pct).div(100), decimals), base);
  }
  if (discount.type !== 'AMOUNT')
    throw new PricingError(`${field}.type`, `${field}.type must be AMOUNT or PERCENT`);
  return Dec.min(round(parse(discount.value, `${field}.value`, { min: ZERO }), decimals), base);
}

/**
 * Splits `total` over `weights` so the parts are whole units of the currency, sum exactly to the
 * total, and no part exceeds its cap. Parts get their rounded-down share; the units left over go
 * to the largest remainders (ties to the earlier line).
 */
function allocate(
  total: Dec,
  weights: readonly Dec[],
  caps: readonly Dec[],
  decimals: number,
): Dec[] {
  const unit = new Dec(10).pow(-decimals);
  const sum = weights.reduce((a, b) => a.plus(b), ZERO);
  if (total.isZero() || sum.isZero()) return weights.map(() => ZERO);
  const exact = weights.map((w) => total.mul(w).div(sum));
  const parts = exact.map((e) => e.toDecimalPlaces(decimals, Decimal.ROUND_DOWN));
  let left = total
    .minus(parts.reduce((a, b) => a.plus(b), ZERO))
    .div(unit)
    .toNumber();
  const order = exact
    .map((e, i) => ({ i, remainder: e.minus(parts[i] as Dec) }))
    .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    const next = (parts[i] as Dec).plus(unit);
    if (next.lte(caps[i] as Dec)) {
      parts[i] = next;
      left -= 1;
    }
  }
  return parts;
}

export function calculateDocument(input: PricingInput): PricingResult {
  const decimals = input.currencyDecimals;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4) {
    throw new PricingError(
      'currencyDecimals',
      'currencyDecimals must be a whole number from 0 to 4',
    );
  }

  // 1-2. gross and the line discount
  const prepared = input.lines.map((line, i) => {
    const field = `lines[${i}]`;
    const quantity = parse(line.quantity, `${field}.quantity`);
    if (quantity.lte(0))
      throw new PricingError(`${field}.quantity`, `${field}.quantity must be greater than zero`);
    const unitPrice = parse(line.unitPrice, `${field}.unitPrice`, { min: ZERO });
    const taxRate = parse(line.taxRate ?? '0', `${field}.taxRate`, { min: ZERO, max: new Dec(1) });
    const gross = round(quantity.mul(unitPrice), decimals);
    const lineDiscount = discountAmount(line.discount, gross, `${field}.discount`, decimals);
    return { gross, lineDiscount, afterLine: gross.minus(lineDiscount), taxRate };
  });

  // 3. the order discount, shared out in proportion to each line's net after its own discount
  const afterLineTotal = prepared.reduce((a, l) => a.plus(l.afterLine), ZERO);
  const orderDiscount = discountAmount(
    input.orderDiscount,
    afterLineTotal,
    'orderDiscount',
    decimals,
  );
  const shares = allocate(
    orderDiscount,
    prepared.map((l) => l.afterLine),
    prepared.map((l) => l.afterLine),
    decimals,
  );

  // 4-5. tax and line totals
  const lines = prepared.map((l, i) => {
    const allocated = shares[i] as Dec;
    const discount = l.lineDiscount.plus(allocated);
    const net = l.gross.minus(discount);
    let tax: Dec;
    let lineTotal: Dec;
    let netExTax: Dec;
    if (input.pricesIncludeTax) {
      tax = round(net.minus(net.div(l.taxRate.plus(1))), decimals);
      lineTotal = net;
      netExTax = net.minus(tax);
    } else {
      tax = round(net.mul(l.taxRate), decimals);
      lineTotal = net.plus(tax);
      netExTax = net;
    }
    return { l, allocated, discount, net, tax, lineTotal, netExTax };
  });

  // 6. totals, then cash rounding
  const sumTotals = lines.reduce((a, x) => a.plus(x.lineTotal), ZERO);
  let rounding = ZERO;
  if (input.cashRoundingIncrement != null && input.cashRoundingIncrement !== '') {
    const increment = parse(input.cashRoundingIncrement, 'cashRoundingIncrement');
    if (increment.lte(0))
      throw new PricingError(
        'cashRoundingIncrement',
        'cashRoundingIncrement must be greater than zero',
      );
    rounding = sumTotals
      .div(increment)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .mul(increment)
      .minus(sumTotals);
  }

  const breakdown = new Map<string, { taxable: Dec; tax: Dec }>();
  for (const x of lines) {
    const key = x.l.taxRate.toFixed();
    const entry = breakdown.get(key) ?? { taxable: ZERO, tax: ZERO };
    breakdown.set(key, { taxable: entry.taxable.plus(x.netExTax), tax: entry.tax.plus(x.tax) });
  }

  const fmt = (d: Dec) => d.toFixed(decimals);
  return {
    lines: lines.map((x) => ({
      gross: fmt(x.l.gross),
      lineDiscountAmount: fmt(x.l.lineDiscount),
      allocatedDiscount: fmt(x.allocated),
      discountAmount: fmt(x.discount),
      net: fmt(x.net),
      netExcludingTax: fmt(x.netExTax),
      taxAmount: fmt(x.tax),
      lineTotal: fmt(x.lineTotal),
    })),
    subtotal: fmt(prepared.reduce((a, l) => a.plus(l.gross), ZERO)),
    discountAmount: fmt(lines.reduce((a, x) => a.plus(x.discount), ZERO)),
    orderDiscountAmount: fmt(orderDiscount),
    taxAmount: fmt(lines.reduce((a, x) => a.plus(x.tax), ZERO)),
    roundingAmount: fmt(rounding),
    total: fmt(sumTotals.plus(rounding)),
    taxBreakdown: [...breakdown.entries()]
      .sort(([a], [b]) => new Dec(a).comparedTo(new Dec(b)))
      .map(([rate, e]) => ({ rate, taxableAmount: fmt(e.taxable), taxAmount: fmt(e.tax) })),
  };
}

/** A line's effective discount as a percentage of its gross (line discount plus allocated share). */
export function effectiveDiscountPercent(
  line: Pick<PricingLineResult, 'gross' | 'discountAmount'>,
): string {
  const gross = new Dec(line.gross);
  if (gross.isZero()) return '0';
  return new Dec(line.discountAmount)
    .div(gross)
    .mul(100)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toFixed();
}
