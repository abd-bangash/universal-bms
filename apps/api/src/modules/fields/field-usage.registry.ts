import { Injectable } from '@nestjs/common';

/**
 * Modules that store custom field values register a check per entity type, so that a field key
 * cannot change once any record carries a value for it (Requirement 26.2). An entity type with no
 * registered check is treated as in use, which is the safe answer.
 */
@Injectable()
export class FieldUsageRegistry {
  private readonly checks = new Map<string, (key: string) => Promise<boolean>>();

  register(entityType: string, isUsed: (key: string) => Promise<boolean>): void {
    this.checks.set(entityType, isUsed);
  }

  async isUsed(entityType: string, key: string): Promise<boolean> {
    const check = this.checks.get(entityType);
    return check ? check(key) : true;
  }
}
