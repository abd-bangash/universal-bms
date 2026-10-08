import { Module, type OnModuleInit } from '@nestjs/common';
import { WorkspaceDefaultsRegistry } from '../tenants/registries';
import { ensureAdjustmentReasons } from './inventory-defaults';

/** Stock ledger, levels, reservations and locations (tasks 45 to 48). */
@Module({})
export class InventoryModule implements OnModuleInit {
  constructor(private readonly defaults: WorkspaceDefaultsRegistry) {}

  onModuleInit(): void {
    this.defaults.register('adjustment-reasons', (tx, ctx) =>
      ensureAdjustmentReasons(tx, ctx.workspaceId),
    );
  }
}
