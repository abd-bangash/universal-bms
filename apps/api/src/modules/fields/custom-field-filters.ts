import { Prisma } from '@prisma/client';
import { optionsOf, type FieldDefinitionLike } from '@bms/calc';
import { ValidationFailedException } from '../../common/errors/app.exception';

/**
 * Parsing of `?cf.<key>=value`, `?cf.<key>.gte=` and `?cf.<key>.lte=` list filters into JSONB
 * conditions (Requirements 26.7, 28.7). Equality works for every type; ranges only for number,
 * date, currency and measurement (a measurement compares the stored value in the stored unit).
 */
export type CustomFieldFilter =
  | { key: string; op: 'eq'; value: unknown }
  | { key: string; op: 'gte' | 'lte'; value: string; kind: 'numeric' | 'date' | 'measurement' };

const RANGE_KINDS: Record<string, 'numeric' | 'date' | 'measurement'> = {
  NUMBER: 'numeric',
  CURRENCY: 'numeric',
  DATE: 'date',
  MEASUREMENT: 'measurement',
};
const NUMERIC = /^-?\d{1,18}(\.\d{1,8})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseCustomFieldFilters(
  query: Record<string, unknown>,
  definitions: readonly FieldDefinitionLike[],
): CustomFieldFilter[] {
  const byKey = new Map(definitions.map((d) => [d.key, d]));
  const filters: CustomFieldFilter[] = [];
  const errors: Record<string, string[]> = {};

  for (const [name, raw] of Object.entries(query)) {
    const match = /^cf\.([a-z][a-z0-9_]*)(?:\.(gte|lte))?$/.exec(name);
    if (!match) continue;
    const [, key, range] = match as unknown as [string, string, 'gte' | 'lte' | undefined];
    const definition = byKey.get(key);
    const fail = (message: string) => (errors[name] = [message]);
    if (!definition) {
      fail('is not a defined field');
      continue;
    }
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string' || value === '') {
      fail('must be a value');
      continue;
    }

    if (range) {
      const kind = RANGE_KINDS[definition.type];
      if (!kind) {
        fail(`range filters are not available for ${definition.type.toLowerCase()} fields`);
      } else if (!(kind === 'date' ? DATE : NUMERIC).test(value)) {
        fail(kind === 'date' ? 'must be a date (YYYY-MM-DD)' : 'must be a number');
      } else {
        filters.push({ key, op: range, value, kind });
      }
      continue;
    }

    switch (definition.type) {
      case 'BOOLEAN':
        if (value !== 'true' && value !== 'false') fail('must be true or false');
        else filters.push({ key, op: 'eq', value: value === 'true' });
        break;
      case 'DROPDOWN':
        if (!optionsOf(definition).some((o) => o.key === value)) fail('is not an allowed option');
        else filters.push({ key, op: 'eq', value });
        break;
      case 'MULTI_SELECT':
        if (!optionsOf(definition).some((o) => o.key === value)) fail('is not an allowed option');
        else filters.push({ key, op: 'eq', value: [value] }); // contains the option
        break;
      case 'MEASUREMENT':
        if (!NUMERIC.test(value)) fail('must be a number');
        else filters.push({ key, op: 'eq', value: { value } });
        break;
      default:
        filters.push({ key, op: 'eq', value });
    }
  }
  if (Object.keys(errors).length > 0) throw new ValidationFailedException(errors);
  return filters;
}

/**
 * SQL conditions over a jsonb column (`column` must be a trusted identifier such as `"custom_fields"`).
 * Equality uses containment, which the GIN index serves; ranges cast the stored text.
 */
export function customFieldConditions(
  filters: readonly CustomFieldFilter[],
  column: string,
): Prisma.Sql[] {
  const col = Prisma.raw(column);
  return filters.map((f) => {
    if (f.op === 'eq') {
      return Prisma.sql`${col} @> ${JSON.stringify({ [f.key]: f.value })}::jsonb`;
    }
    const path =
      f.kind === 'measurement'
        ? Prisma.sql`(${col} -> ${f.key}) ->> 'value'`
        : Prisma.sql`${col} ->> ${f.key}`;
    const cast = f.kind === 'date' ? Prisma.raw('date') : Prisma.raw('numeric');
    const operator = f.op === 'gte' ? Prisma.raw('>=') : Prisma.raw('<=');
    return Prisma.sql`(${path})::${cast} ${operator} ${f.value}::${cast}`;
  });
}
