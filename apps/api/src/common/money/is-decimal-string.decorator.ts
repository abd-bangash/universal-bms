import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isDecimalString } from './money';

/** DTO validator: the value must be a decimal string such as "12.50" (never a JSON number). */
export function IsDecimalString(options?: ValidationOptions) {
  return (target: object, propertyName: string): void => {
    registerDecorator({
      name: 'isDecimalString',
      target: target.constructor,
      propertyName,
      options: { message: `${propertyName} must be a decimal string`, ...options },
      validator: { validate: (value: unknown) => isDecimalString(value) },
    });
  };
}
