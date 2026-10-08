import Decimal from 'decimal.js';

/**
 * Commission arithmetic (Requirements 14.1, 14.2, 41.3 to 41.5). Pure functions over decimal
 * STRINGS, so the same rules can be tested exhaustively and used by the service unchanged.
 */
const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type Dec = InstanceType<typeof Dec>;

export type CommissionCalcType = 'PERCENTAGE' | 'FIXED_PER_ORDER' | 'FIXED_PER_UNIT';
export type CommissionBaseType = 'NET_SALES' | 'GROSS_SALES' | 'GROSS_PROFIT';
export type CommissionScope = 'ALL' | 'CATEGORY' | 'PRODUCT' | 'ORDER_TYPE';

export interface CommissionRuleInput {
  id: string;
  calcType: CommissionCalcType;
  /** A percentage (12.5 = 12.5%) for PERCENTAGE, an amount otherwise. */
  rate: string;
  baseType: CommissionBaseType;
  scope: CommissionScope;
  /** A category id, a product id or an order type; null for ALL. */
  scopeId: string | null;
  /** Null applies to every salesperson. */
  salespersonId: string | null;
  priority: number;
  /** Milliseconds since the epoch; later wins a tie. */
  createdAt: number;
}

export interface CommissionLineInput {
  /** Identifies the line in the result. */
  key: string;
  lineNo: number;
  productId: string | null;
  /** The product's category and its ancestors, so a rule on a parent category applies to its children. */
  categoryIds: readonly string[];
  quantity: string;
  unitPrice: string;
  /** Line total less its tax: after every discount, before tax. */
  netAmount: string;
  /** Cost per unit when known; zero otherwise. */
  costPrice: string | null;
}

export interface CommissionSalespersonInput {
  userId: string;
  /** A percentage; the shares of one order total 100. */
  sharePercent: string;
}

export interface CommissionRow {
  salespersonId: string;
  lineKey: string;
  rule: CommissionRuleInput;
  calculationBase: string;
  sharePercent: string;
  amount: string;
}

/** Whether a rule can apply to a line of an order of this type, for this salesperson. */
export function ruleApplies(
  rule: CommissionRuleInput,
  line: Pick<CommissionLineInput, 'productId' | 'categoryIds'>,
  orderType: string,
  salespersonId: string,
): boolean {
  if (rule.salespersonId !== null && rule.salespersonId !== salespersonId) return false;
  switch (rule.scope) {
    case 'ALL':
      return true;
    case 'PRODUCT':
      return rule.scopeId !== null && rule.scopeId === line.productId;
    case 'CATEGORY':
      return rule.scopeId !== null && line.categoryIds.includes(rule.scopeId);
    case 'ORDER_TYPE':
      return rule.scopeId !== null && rule.scopeId === orderType;
  }
}

const SCOPE_RANK: Record<CommissionScope, number> = {
  PRODUCT: 0,
  CATEGORY: 1,
  ORDER_TYPE: 2,
  ALL: 3,
};

/**
 * The rule for a line, by the order of Requirement 41.4: rules for this salesperson before general
 * rules; then product scope, category scope, order-type scope, all-products scope; then the
 * highest priority; then the most recently created (ties on that fall to the larger id so the
 * choice never depends on the order the rules arrive in).
 */
export function selectRule(
  rules: readonly CommissionRuleInput[],
  line: Pick<CommissionLineInput, 'productId' | 'categoryIds'>,
  orderType: string,
  salespersonId: string,
): CommissionRuleInput | null {
  const candidates = rules.filter((r) => ruleApplies(r, line, orderType, salespersonId));
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) =>
      Number(b.salespersonId !== null) - Number(a.salespersonId !== null) ||
      SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope] ||
      b.priority - a.priority ||
      b.createdAt - a.createdAt ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  )[0] as CommissionRuleInput;
}

/** The amount the rule's percentage applies to for one line; never negative. */
export function commissionBase(
  baseType: CommissionBaseType,
  line: Pick<CommissionLineInput, 'quantity' | 'unitPrice' | 'netAmount' | 'costPrice'>,
): string {
  const net = new Dec(line.netAmount);
  let base: Dec;
  if (baseType === 'NET_SALES') base = net;
  else if (baseType === 'GROSS_SALES') base = new Dec(line.quantity).mul(line.unitPrice);
  else base = net.minus(new Dec(line.quantity).mul(line.costPrice ?? '0'));
  return Dec.max(base, 0).toString();
}

/**
 * The amount before the salesperson's share: a percentage of the base, a fixed amount per unit,
 * or a fixed amount (per order, which the caller applies once).
 */
export function unsplitAmount(
  rule: Pick<CommissionRuleInput, 'calcType' | 'rate'>,
  base: string,
  quantity: string,
): Dec {
  if (rule.calcType === 'PERCENTAGE') return new Dec(base).mul(rule.rate).div(100);
  if (rule.calcType === 'FIXED_PER_UNIT') return new Dec(rule.rate).mul(quantity);
  return new Dec(rule.rate);
}

/** The commission for one salesperson on one line: share of the formula, rounded half-up. */
export function commissionAmount(
  rule: Pick<CommissionRuleInput, 'calcType' | 'rate'>,
  base: string,
  quantity: string,
  sharePercent: string,
  currencyDecimals: number,
): string {
  return unsplitAmount(rule, base, quantity)
    .mul(sharePercent)
    .div(100)
    .toDecimalPlaces(currencyDecimals, Decimal.ROUND_HALF_UP)
    .toFixed(currencyDecimals);
}

/**
 * All the commission rows for an order. Each salesperson is judged separately (their own rules
 * come first); a line with no matching rule makes no row. A FIXED_PER_ORDER rule pays once per
 * salesperson, on the first line that selected it. Zero amounts make no row.
 */
export function calculateCommissions(input: {
  rules: readonly CommissionRuleInput[];
  lines: readonly CommissionLineInput[];
  salespeople: readonly CommissionSalespersonInput[];
  orderType: string;
  currencyDecimals: number;
}): CommissionRow[] {
  const rows: CommissionRow[] = [];
  const lines = [...input.lines].sort((a, b) => a.lineNo - b.lineNo);
  for (const person of input.salespeople) {
    const paidPerOrder = new Set<string>();
    for (const line of lines) {
      const rule = selectRule(input.rules, line, input.orderType, person.userId);
      if (!rule) continue;
      if (rule.calcType === 'FIXED_PER_ORDER') {
        if (paidPerOrder.has(rule.id)) continue;
        paidPerOrder.add(rule.id);
      }
      const base = commissionBase(rule.baseType, line);
      const amount = commissionAmount(
        rule,
        base,
        line.quantity,
        person.sharePercent,
        input.currencyDecimals,
      );
      if (new Dec(amount).isZero()) continue;
      rows.push({
        salespersonId: person.userId,
        lineKey: line.key,
        rule,
        calculationBase: base,
        sharePercent: person.sharePercent,
        amount,
      });
    }
  }
  return rows;
}
