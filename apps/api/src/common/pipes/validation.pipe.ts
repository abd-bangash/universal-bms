import { ValidationPipe, type ValidationError } from '@nestjs/common';
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

/** Whitelists, rejects unknown properties, transforms, and reports field-level errors. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new ValidationFailedException(flatten(errors)),
  });
}
