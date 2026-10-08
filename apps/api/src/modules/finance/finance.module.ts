import { Module, type OnModuleInit } from '@nestjs/common';
import { ProfileSectionRegistry, WorkspaceDefaultsRegistry } from '../tenants/registries';
import { applyProfileExpenseCategories, ensureFinanceDefaults } from './finance-defaults';

/** Accounts, payment methods, payments, credit and expenses (tasks 39 to 43). */
@Module({})
export class FinanceModule implements OnModuleInit {
  constructor(
    private readonly defaults: WorkspaceDefaultsRegistry,
    private readonly sections: ProfileSectionRegistry,
  ) {}

  onModuleInit(): void {
    this.defaults.register('finance', (tx, ctx) => ensureFinanceDefaults(tx, ctx.workspaceId));
    this.sections.register('expenseCategories', applyProfileExpenseCategories);
  }
}
