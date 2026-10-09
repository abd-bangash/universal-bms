import {
  ValidationPipe,
  type ArgumentMetadata,
  type ValidationError,
  type ValidationPipeOptions,
} from '@nestjs/common';
import { ValidationFailedException } from '../errors/app.exception';

function flatten(errors: ValidationError[], prefix = ''): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    if (error.constraints) out[path] = Object.values(error.constraints);
    if (error.children?.length) Object.assign(out, flatten(error.children, path));
  }
  return out;
}

/** The path of the first string holding a NUL character, which PostgreSQL text columns cannot store. */
export function findNul(value: unknown, path = ''): string | null {
  if (typeof value === 'string') return value.includes('\u0000') ? path || 'value' : null;
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const found = findNul(item, `${path}[${i}]`);
      if (found) return found;
    }
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const found = findNul(item, path ? `${path}.${key}` : key);
      if (found) return found;
    }
  }
  return null;
}

/** The same text without NUL characters, for data we receive rather than ask for (a provider's webhook). */
export function stripNul<T>(value: T): T {
  if (typeof value === 'string') return value.replaceAll('\u0000', '') as T;
  if (Array.isArray(value)) return value.map((v) => stripNul(v)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripNul(v)])) as T;
  }
  return value;
}

/**
 * `?cf.<key>=` list filters are validated by the custom-field engine against the workspace's
 * definitions (Requirement 26.7), so the DTO whitelist must not reject them as unknown properties.
 */
class AppValidationPipe extends ValidationPipe {
  constructor(options: ValidationPipeOptions) {
    super(options);
  }

  override transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    // text with a NUL in it cannot be stored: refuse it as a bad request instead of failing in the database
    const nul = metadata.type === 'custom' ? null : findNul(value);
    if (nul) {
      throw new ValidationFailedException({
        [nul.replace(/^value$/, metadata.data ?? 'value')]: [
          'contains a character that is not allowed',
        ],
      });
    }
    if (metadata.type === 'query' && value && typeof value === 'object' && !Array.isArray(value)) {
      const rest = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(([key]) => !key.startsWith('cf.')),
      );
      return super.transform(rest, metadata);
    }
    return super.transform(value, metadata);
  }
}

/** Whitelists, rejects unknown properties, transforms, and reports field-level errors. */
export function createValidationPipe(): ValidationPipe {
  return new AppValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new ValidationFailedException(flatten(errors)),
  });
}
