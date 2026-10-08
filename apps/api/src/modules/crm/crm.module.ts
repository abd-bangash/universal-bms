import { Module, type OnModuleInit } from '@nestjs/common';
import { ProfileSectionRegistry, WorkspaceDefaultsRegistry } from '../tenants/registries';
import { applyProfileLostReasons, ensureWalkInCustomer } from './crm-defaults';
import { CustomerFinanceService } from './customer-finance.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { PhoneService } from './phone.service';
import { TimelineListener } from './timeline.listener';
import { TimelineService } from './timeline.service';

/** Customers, Leads, Tasks and the timeline. Leads arrive in task 26, tasks and notes in task 27. */
@Module({
  controllers: [CustomersController],
  providers: [
    CustomersService,
    CustomerFinanceService,
    DuplicateDetectionService,
    PhoneService,
    TimelineService,
    TimelineListener,
  ],
  exports: [CustomersService, PhoneService, TimelineService, DuplicateDetectionService],
})
export class CrmModule implements OnModuleInit {
  constructor(
    private readonly defaults: WorkspaceDefaultsRegistry,
    private readonly sections: ProfileSectionRegistry,
  ) {}

  onModuleInit(): void {
    this.defaults.register('walk-in-customer', (tx, ctx) =>
      ensureWalkInCustomer(tx, ctx.workspaceId),
    );
    this.sections.register('lostReasons', applyProfileLostReasons);
  }
}
