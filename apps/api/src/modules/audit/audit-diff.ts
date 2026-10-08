import { Prisma } from '@prisma/client';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const SENSITIVE_KEY =
  /(password|passwd|secret|token|hash|api[-_]?key|authorization|cookie|private[-_]?key|encrypted|credential)/i;
export const REDACTED = '[REDACTED]';

/** Converts values to JSON-safe form: Decimals and bigints as strings, Dates as ISO strings. */
export function toJsonSafe(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toFixed();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (typeof value === 'object') {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (inner !== undefined) out[key] = toJsonSafe(inner);
    }
    return out;
  }
  if (typeof value === 'function' || typeof value === 'symbol') return null;
  return value as string | number | boolean;
}

/** Replaces the value of every sensitive key, at any depth. */
export function redact(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(inner);
    }
    return out;
  }
  return value;
}

export interface StateChange {
  previousState: JsonValue | null;
  newState: JsonValue | null;
}

type Plain = Record<string, unknown>;

/**
 * What an audit event stores: for an update only the fields that changed (old and new value);
 * for a create the new state; for a delete or archive the previous state. Secrets are redacted.
 */
export function computeStateChange(before?: Plain | null, after?: Plain | null): StateChange {
  const prev = before ? (toJsonSafe(before) as { [k: string]: JsonValue }) : null;
  const next = after ? (toJsonSafe(after) as { [k: string]: JsonValue }) : null;

  if (prev && next) {
    const previousState: { [k: string]: JsonValue } = {};
    const newState: { [k: string]: JsonValue } = {};
    for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
      if (JSON.stringify(prev[key] ?? null) !== JSON.stringify(next[key] ?? null)) {
        if (key in prev) previousState[key] = prev[key] as JsonValue;
        if (key in next) newState[key] = next[key] as JsonValue;
      }
    }
    return { previousState: redact(previousState), newState: redact(newState) };
  }
  return {
    previousState: prev ? redact(prev) : null,
    newState: next ? redact(next) : null,
  };
}
