import { Module, type OnModuleInit } from '@nestjs/common';
import { WorkflowRegistry } from '../workflows/workflow.registry';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { registerPurchaseRules } from './purchase-workflow';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

/** Suppliers, purchase orders and goods receipts (tasks 55 to 58). */
@Module({
  imports: [InventoryModule],
  controllers: [SuppliersController, PurchasesController],
  providers: [SuppliersService, PurchasesService],
  exports: [SuppliersService, PurchasesService],
})
export class PurchasingModule implements OnModuleInit {
  constructor(private readonly registry: WorkflowRegistry) {}

  onModuleInit(): void {
    registerPurchaseRules(this.registry);
  }
}
