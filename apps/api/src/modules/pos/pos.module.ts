import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SalesModule } from '../sales/sales.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

/** Counter sales and their receipts (tasks 50 to 53). */
@Module({
  imports: [SalesModule, InventoryModule, CrmModule],
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
