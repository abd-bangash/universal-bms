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
  /** Ancestors of `categoryId`, so a field scoped to a parent Category applies to its sub-categories. */
  categoryPath?: readonly string[];
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
  if (
    definition.categoryId &&
    ctx.categoryId !== definition.categoryId &&
    !ctx.categoryPath?.includes(definition.categoryId)
  ) {
    return false;
  }
  if (!definition.visibleWhen) return true;
  return evaluateCondition(definition.visibleWhen, ctx);
}

// ── Validation (task 18) ─────────────────────────────────────────────────────────────────────

export type FieldValueType =
  | 'TEXT'
  | 'NUMBER'
  | 'DATE'
  | 'BOOLEAN'
  | 'DROPDOWN'
  | 'MULTI_SELECT'
  | 'MEASUREMENT'
  | 'CURRENCY'
  | 'IMAGE'
  | 'REFERENCE';

export interface FieldOption {
  key: string;
  label: string;
}

/** The part of a Field_Definition the shared functions need; the Prisma row satisfies it. */
export interface FieldDefinitionLike extends VisibilityDefinition {
  key: string;
  label: string;
  type: FieldValueType;
  unitDimension?: string | null;
  defaultUnit?: string | null;
  options?: unknown;
  required?: boolean;
  defaultValue?: unknown;
  active?: boolean;
  sortOrder?: number;
}

export interface ValidationContext extends VisibilityContext {
  /** Known unit symbols and their dimension. When absent, any unit symbol is accepted. */
  units?: Record<string, string>;
  /** Values already stored on the record; values of deactivated fields are carried over from here. */
  existing?: Record<string, unknown>;
}

export type ValidationResult =
  { ok: true; values: Record<string, unknown> } | { ok: false; errors: Record<string, string[]> };

const NUMBER_PATTERN = /^-?\d{1,18}(\.\d{1,8})?$/;
const CURRENCY_PATTERN = /^\d{1,14}(\.\d{1,4})?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_TEXT = 2000;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Decimal values are stored as strings; a JSON number is accepted and converted without exponent. */
function asDecimalString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const text = String(value);
    return /e/i.test(text) ? null : text;
  }
  return null;
}

function isCalendarDate(text: string): boolean {
  const m = DATE_PATTERN.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function optionsOf(definition: Pick<FieldDefinitionLike, 'options'>): FieldOption[] {
  const raw = definition.options;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (o): o is FieldOption =>
      isPlainObject(o) && typeof o.key === 'string' && typeof o.label === 'string',
  );
}

/** Validates one value; returns the normalised value or an error message. */
function checkValue(
  definition: FieldDefinitionLike,
  value: unknown,
  ctx: ValidationContext,
): { value: unknown } | { error: string } {
  switch (definition.type) {
    case 'TEXT':
      if (typeof value !== 'string') return { error: 'must be text' };
      if (value.length > MAX_TEXT) return { error: `must be at most ${MAX_TEXT} characters` };
      return { value };
    case 'NUMBER': {
      const text = asDecimalString(value);
      if (text === null || !NUMBER_PATTERN.test(text)) return { error: 'must be a number' };
      return { value: text };
    }
    case 'CURRENCY': {
      const text = asDecimalString(value);
      if (text === null || !CURRENCY_PATTERN.test(text)) {
        return { error: 'must be an amount of money (at most 4 decimals)' };
      }
      return { value: text };
    }
    case 'DATE':
      if (typeof value !== 'string' || !isCalendarDate(value)) {
        return { error: 'must be a date in YYYY-MM-DD format' };
      }
      return { value };
    case 'BOOLEAN':
      return typeof value === 'boolean' ? { value } : { error: 'must be true or false' };
    case 'DROPDOWN': {
      const keys = optionsOf(definition).map((o) => o.key);
      if (typeof value !== 'string' || !keys.includes(value)) {
        return { error: 'must be one of the allowed options' };
      }
      return { value };
    }
    case 'MULTI_SELECT': {
      const keys = optionsOf(definition).map((o) => o.key);
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !keys.includes(v))) {
        return { error: 'must be a list of allowed options' };
      }
      if (new Set(value).size !== value.length) return { error: 'must not repeat an option' };
      return { value: [...(value as string[])] };
    }
    case 'MEASUREMENT': {
      if (!isPlainObject(value)) return { error: 'must be { value, unit }' };
      const text = asDecimalString(value.value);
      if (text === null || !NUMBER_PATTERN.test(text)) {
        return { error: 'must have a numeric value' };
      }
      const unit =
        typeof value.unit === 'string' && value.unit !== ''
          ? value.unit
          : (definition.defaultUnit ?? '');
      if (unit === '') return { error: 'must have a unit' };
      if (ctx.units) {
        const dimension = ctx.units[unit];
        if (dimension === undefined) return { error: `unit "${unit}" is not known` };
        if (definition.unitDimension && dimension !== definition.unitDimension) {
          return { error: `unit "${unit}" is not a ${definition.unitDimension} unit` };
        }
      }
      return { value: { value: text, unit } };
    }
    case 'IMAGE':
      return typeof value === 'string' && value !== '' ? { value } : { error: 'must be a file' };
    case 'REFERENCE':
      if (
        !isPlainObject(value) ||
        typeof value.entityType !== 'string' ||
        value.entityType === '' ||
        typeof value.id !== 'string' ||
        value.id === ''
      ) {
        return { error: 'must be { entityType, id }' };
      }
      return { value: { entityType: value.entityType, id: value.id } };
  }
}

/**
 * Validates `values` against the definitions that apply to the record (Requirement 26.3).
 * - unknown keys are rejected; keys of deactivated fields cannot be written but their stored values
 *   are carried over from `ctx.existing` (26.6);
 * - fields hidden by their category scope or visibility condition are dropped and never required (26.4);
 * - a missing value falls back to the definition's default; `null` and `''` clear an optional field.
 * Visibility is evaluated on the values as submitted (merged over `existing`).
 */
export function validateCustomFields(
  definitions: readonly FieldDefinitionLike[],
  values: Record<string, unknown> | null | undefined,
  ctx: ValidationContext,
): ValidationResult {
  const input = values ?? {};
  const existing = ctx.existing ?? {};
  const errors: Record<string, string[]> = {};
  const add = (key: string, message: string) => (errors[key] ??= []).push(message);
  const byKey = new Map(definitions.map((d) => [d.key, d]));

  for (const key of Object.keys(input)) {
    const definition = byKey.get(key);
    if (!definition) add(key, 'is not a defined field');
    else if (definition.active === false) add(key, 'is deactivated');
  }

  const effective: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === '') delete effective[key];
    else effective[key] = value;
  }
  const visibility: VisibilityContext = { ...ctx, values: effective };

  const result: Record<string, unknown> = {};
  for (const definition of definitions) {
    const { key } = definition;
    if (definition.active === false) {
      if (key in existing) result[key] = existing[key];
      continue;
    }
    if (!isVisible(definition, visibility)) continue;
    if (errors[key]) continue;

    let raw = effective[key];
    if (isEmpty(raw) && definition.defaultValue !== undefined && definition.defaultValue !== null) {
      raw = definition.defaultValue;
    }
    if (isEmpty(raw)) {
      if (definition.required) add(key, 'is required');
      continue;
    }
    const checked = checkValue(definition, raw, ctx);
    if ('error' in checked) add(key, checked.error);
    else result[key] = checked.value;
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values: result };
}

// ── Snapshot (Requirement 26.8) ─────────────────────────────────────────────────────────────

export interface FieldSnapshotEntry {
  key: string;
  label: string;
  value: string;
  unit: string | null;
}

/**
 * Freezes the label, value and unit of each stored custom field on a document line so later edits to a
 * Field_Definition do not change history. Option keys are replaced by their labels.
 */
export function buildFieldSnapshot(
  definitions: readonly FieldDefinitionLike[],
  values: Record<string, unknown> | null | undefined,
): FieldSnapshotEntry[] {
  const stored = values ?? {};
  return [...definitions]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .flatMap((definition): FieldSnapshotEntry[] => {
      const value = stored[definition.key];
      if (isEmpty(value)) return [];
      const entry = (text: string, unit: string | null = null) => [
        { key: definition.key, label: definition.label, value: text, unit },
      ];
      const optionLabel = (key: string) =>
        optionsOf(definition).find((o) => o.key === key)?.label ?? key;
      switch (definition.type) {
        case 'DROPDOWN':
          return entry(optionLabel(String(value)));
        case 'MULTI_SELECT':
          return entry((value as string[]).map(optionLabel).join(', '));
        case 'BOOLEAN':
          return entry(value === true ? 'Yes' : 'No');
        case 'MEASUREMENT': {
          const m = value as { value: string; unit: string };
          return entry(m.value, m.unit);
        }
        case 'REFERENCE':
          return entry((value as { id: string }).id);
        default:
          return entry(String(value));
      }
    });
}
