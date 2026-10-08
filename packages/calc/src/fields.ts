/**
 * Custom-field helpers shared by the API and the web app, so both always agree
 * (Requirement 26.5). This file grows in task 18; the visibility evaluator is needed earlier
 * by the web application's shared `DynamicFields` component.
 */

/** Operators of a visibility condition (design.md "Configuration Engine"). */
export type ConditionOp = 'eq' | 'neq' | 'in' | 'gt' | 'lt' | 'exists';

export type Condition =
  | { all?: Condition[]; any?: Condition[] }
  | {
      source: 'field' | 'productType' | 'categoryId' | 'status';
      key?: string;
      op: ConditionOp;
      value?: unknown;
    };

/** What a condition can look at: the record's own values and its product type, category and status. */
export interface VisibilityContext {
  values: Record<string, unknown>;
  productType?: string | null;
  categoryId?: string | null;
  status?: string | null;
}

export interface VisibilityDefinition {
  visibleWhen?: Condition | null;
  categoryId?: string | null;
}

function actualValue(
  condition: Extract<Condition, { source: string }>,
  ctx: VisibilityContext,
): unknown {
  switch (condition.source) {
    case 'field':
      return condition.key === undefined ? undefined : ctx.values[condition.key];
    case 'productType':
      return ctx.productType ?? undefined;
    case 'categoryId':
      return ctx.categoryId ?? undefined;
    case 'status':
      return ctx.status ?? undefined;
  }
}

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Numbers and decimal strings compare numerically; everything else compares by its text. */
function compare(actual: unknown, expected: unknown): number | null {
  const a =
    typeof actual === 'number'
      ? actual
      : typeof actual === 'string' && actual.trim() !== ''
        ? Number(actual)
        : NaN;
  const e =
    typeof expected === 'number'
      ? expected
      : typeof expected === 'string' && expected.trim() !== ''
        ? Number(expected)
        : NaN;
  if (Number.isNaN(a) || Number.isNaN(e)) return null;
  return a === e ? 0 : a < e ? -1 : 1;
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) return actual.some((item) => sameValue(item, expected));
  return String(actual) === String(expected);
}

export function evaluateCondition(condition: Condition, ctx: VisibilityContext): boolean {
  if ('source' in condition) {
    const actual = actualValue(condition, ctx);
    switch (condition.op) {
      case 'exists':
        return !isEmpty(actual);
      case 'eq':
        return !isEmpty(actual) && sameValue(actual, condition.value);
      case 'neq':
        return isEmpty(actual) || !sameValue(actual, condition.value);
      case 'in':
        return (
          !isEmpty(actual) &&
          Array.isArray(condition.value) &&
          condition.value.some((v) => sameValue(actual, v))
        );
      case 'gt':
        return compare(actual, condition.value) === 1;
      case 'lt':
        return compare(actual, condition.value) === -1;
    }
  }
  const all = condition.all?.every((c) => evaluateCondition(c, ctx)) ?? true;
  const any =
    condition.any === undefined || condition.any.length === 0
      ? true
      : condition.any.some((c) => evaluateCondition(c, ctx));
  return all && any;
}

/**
 * Whether a field is shown (and required) for a record: it is within the field's category scope,
 * and its visibility condition, if any, holds (Requirements 26.4, 26.5).
 */
export function isVisible(definition: VisibilityDefinition, ctx: VisibilityContext): boolean {
  if (definition.categoryId && ctx.categoryId !== definition.categoryId) return false;
  if (!definition.visibleWhen) return true;
  return evaluateCondition(definition.visibleWhen, ctx);
}
