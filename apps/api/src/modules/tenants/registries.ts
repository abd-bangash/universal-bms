import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { IndustryProfileDefinition } from '@bms/validators';

export type Tx = Prisma.TransactionClient;

export interface WorkspaceDefaultsContext {
  workspaceId: string;
  ownerUserId: string;
  profile: IndustryProfileDefinition;
}

/**
 * Later modules add their own defaults to the transaction that creates a workspace
 * (walk-in Customer, cash account and payment methods, adjustment reasons ...).
 * Handlers must be idempotent and use only the given transaction.
 */
@Injectable()
export class WorkspaceDefaultsRegistry {
  private readonly handlers = new Map<
    string,
    (tx: Tx, ctx: WorkspaceDefaultsContext) => Promise<void>
  >();

  register(name: string, handler: (tx: Tx, ctx: WorkspaceDefaultsContext) => Promise<void>): void {
    this.handlers.set(name, handler);
  }

  async run(tx: Tx, ctx: WorkspaceDefaultsContext): Promise<string[]> {
    const ran: string[] = [];
    for (const [name, handler] of this.handlers) {
      await handler(tx, ctx);
      ran.push(name);
    }
    return ran;
  }
}

/**
 * Industry Profile sections that belong to modules introduced later (categories -> catalog,
 * lostReasons -> crm, expenseCategories -> finance). A module registers a handler for its section;
 * until then the section is simply not applied.
 */
@Injectable()
export class ProfileSectionRegistry {
  private readonly handlers = new Map<
    string,
    (tx: Tx, workspaceId: string, items: unknown) => Promise<void>
  >();

  register(
    section: keyof IndustryProfileDefinition,
    handler: (tx: Tx, workspaceId: string, items: unknown) => Promise<void>,
  ): void {
    this.handlers.set(section, handler);
  }

  async apply(tx: Tx, workspaceId: string, profile: IndustryProfileDefinition): Promise<string[]> {
    const applied: string[] = [];
    for (const [section, handler] of this.handlers) {
      await handler(tx, workspaceId, profile[section as keyof IndustryProfileDefinition]);
      applied.push(section);
    }
    return applied;
  }
}
