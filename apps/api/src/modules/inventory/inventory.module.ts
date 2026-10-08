import { Module, type OnModuleInit } from '@nestjs/common';
import { WorkspaceDefaultsRegistry } from '../tenants/registries';
import { ensureAdjustmentReasons } from './inventory-defaults';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { StockOperationsService } from './stock-operations.service';

/** Stock ledger, levels, reservations and locations (tasks 45 to 48). */
@Module({
  controllers: [InventoryController],
  providers: [InventoryService, StockOperationsService],
  exports: [InventoryService, StockOperationsService],
})
export class InventoryModule implements OnModuleInit {
  constructor(private readonly defaults: WorkspaceDefaultsRegistry) {}

  onModuleInit(): void {
    this.defaults.register('adjustment-reasons', (tx, ctx) =>
      ensureAdjustmentReasons(tx, ctx.workspaceId),
    );
  }
}
