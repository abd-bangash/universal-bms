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

/**
 * `?cf.<key>=` list filters are validated by the custom-field engine against the workspace's
 * definitions (Requirement 26.7), so the DTO whitelist must not reject them as unknown properties.
 */
class AppValidationPipe extends ValidationPipe {
  constructor(options: ValidationPipeOptions) {
    super(options);
  }

  override transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
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
