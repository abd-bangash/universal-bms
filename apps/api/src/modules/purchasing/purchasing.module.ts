import { Module, type OnModuleInit } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SearchService } from '../search/search.service';
import { WorkflowRegistry } from '../workflows/workflow.registry';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { registerPurchaseRules } from './purchase-workflow';
import { supplierSearch } from './purchasing-search';
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
  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly search: SearchService,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  onModuleInit(): void {
    registerPurchaseRules(this.registry);
    this.search.register(supplierSearch(this.prisma, this.cls));
  }
}
