import { Injectable } from '@nestjs/common';

/** A dependency the API needs in order to serve traffic (database, Redis, storage). */
export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<void>;
}

/**
 * Modules register their own check in onModuleInit: the database in task 4,
 * storage in task 12 and Redis in task 68.
 */
@Injectable()
export class ReadinessRegistry {
  private readonly checks = new Map<string, ReadinessCheck>();

  register(check: ReadinessCheck): void {
    this.checks.set(check.name, check);
  }

  all(): ReadinessCheck[] {
    return [...this.checks.values()];
  }
}
