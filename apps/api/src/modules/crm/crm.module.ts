import { Module, type OnModuleInit } from '@nestjs/common';
import { ProfileSectionRegistry, WorkspaceDefaultsRegistry } from '../tenants/registries';
import { applyProfileLostReasons, ensureWalkInCustomer } from './crm-defaults';
import { LeadAnalyticsService } from './lead-analytics.service';
import { registerLeadRules } from './lead-workflow';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { WorkflowRegistry } from '../workflows/workflow.registry';
import { EntityLinkRegistry } from './entity-link.registry';
import { NotesService } from './notes.service';
import { TaskDueScheduler } from './task-due.scheduler';
import { TaskListener } from './task.listener';
import { NotesController, TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { CustomerFinanceService } from './customer-finance.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { PhoneService } from './phone.service';
import { TimelineListener } from './timeline.listener';
import { TimelineService } from './timeline.service';

/** Customers, Leads, Tasks and the timeline. Leads arrive in task 26, tasks and notes in task 27. */
@Module({
  controllers: [CustomersController, LeadsController, TasksController, NotesController],
  providers: [
    CustomersService,
    LeadsService,
    LeadAnalyticsService,
    TasksService,
    NotesService,
    EntityLinkRegistry,
    TaskDueScheduler,
    TaskListener,
    CustomerFinanceService,
    DuplicateDetectionService,
    PhoneService,
    TimelineService,
    TimelineListener,
  ],
  exports: [
    CustomersService,
    LeadsService,
    PhoneService,
    TimelineService,
    DuplicateDetectionService,
  ],
})
export class CrmModule implements OnModuleInit {
  constructor(
    private readonly defaults: WorkspaceDefaultsRegistry,
    private readonly sections: ProfileSectionRegistry,
    private readonly workflowRegistry: WorkflowRegistry,
    private readonly links: EntityLinkRegistry,
    private readonly customers: CustomersService,
    private readonly leads: LeadsService,
  ) {}

  onModuleInit(): void {
    this.defaults.register('walk-in-customer', (tx, ctx) =>
      ensureWalkInCustomer(tx, ctx.workspaceId),
    );
    this.sections.register('lostReasons', applyProfileLostReasons);
    registerLeadRules(this.workflowRegistry);
    // Orders, quotations and conversations register themselves when their modules exist.
    this.links.register('CUSTOMER', {
      viewPermission: 'customer:view',
      editPermission: 'customer:edit',
      resolve: async (_user, id) => {
        await this.customers.get(id);
        return { customerId: id };
      },
    });
    this.links.register('LEAD', {
      viewPermission: 'lead:view',
      editPermission: 'lead:edit',
      resolve: async (user, id) => {
        await this.leads.row(user, id);
        return { leadId: id };
      },
    });
  }
}
