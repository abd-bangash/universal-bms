import { Module, type OnModuleInit } from '@nestjs/common';
import { WorkspaceDefaultsRegistry } from '../tenants/registries';
import { WorkflowRegistry } from '../workflows/workflow.registry';
import { ensureAdjustmentReasons } from './inventory-defaults';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ReservationsService } from './reservations.service';
import { StockOperationsService } from './stock-operations.service';

/** Stock ledger, levels, reservations and locations (tasks 45 to 48). */
@Module({
  controllers: [InventoryController],
  providers: [InventoryService, StockOperationsService, ReservationsService],
  exports: [InventoryService, StockOperationsService, ReservationsService],
})
export class InventoryModule implements OnModuleInit {
  constructor(
    private readonly defaults: WorkspaceDefaultsRegistry,
    private readonly workflowRegistry: WorkflowRegistry,
    private readonly reservations: ReservationsService,
  ) {}

  onModuleInit(): void {
    this.defaults.register('adjustment-reasons', (tx, ctx) =>
      ensureAdjustmentReasons(tx, ctx.workspaceId),
    );
    // Stock follows the order workflow (design.md, Workflows): confirming reserves, cancelling
    // gives it back, delivering sells it.
    this.workflowRegistry.registerSideEffect('ORDER', 'CONFIRMED', ({ tx, record }) =>
      this.reservations.reserve(tx, record.id),
    );
    this.workflowRegistry.registerSideEffect('ORDER', 'CANCELLED', ({ tx, record }) =>
      this.reservations.release(tx, record.id),
    );
    this.workflowRegistry.registerSideEffect('ORDER', 'DELIVERED', ({ tx, record, actor }) =>
      this.reservations.fulfil(tx, record.id, actor.userId),
    );
  }
}
