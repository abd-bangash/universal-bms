import { Module, type OnModuleInit } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CrmModule } from '../crm/crm.module';
import { EntityLinkRegistry } from '../crm/entity-link.registry';
import { LeadConversionRegistry } from '../crm/lead-conversion.registry';
import { SearchService } from '../search/search.service';
import { SettingsService } from '../settings/settings.service';
import { WorkflowRegistry } from '../workflows/workflow.registry';
import { DocumentLinesService } from './document-lines.service';
import { registerOrderRules } from './order-workflow';
import { OrderFactory } from './order-factory.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { QuotationExpiryScheduler } from './quotation-expiry.scheduler';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import { orderSearch, quotationSearch } from './sales-search';

/** Quotations (task 34), Orders (35), documents (36). */
@Module({
  imports: [CrmModule],
  controllers: [QuotationsController, OrdersController],
  providers: [
    DocumentLinesService,
    OrderFactory,
    QuotationsService,
    QuotationExpiryScheduler,
    OrdersService,
  ],
  exports: [QuotationsService, OrdersService, OrderFactory, DocumentLinesService],
})
export class SalesModule implements OnModuleInit {
  constructor(
    private readonly conversions: LeadConversionRegistry,
    private readonly links: EntityLinkRegistry,
    private readonly search: SearchService,
    private readonly workflowRegistry: WorkflowRegistry,
    private readonly settings: SettingsService,
    private readonly quotations: QuotationsService,
    private readonly orders: OrdersService,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  onModuleInit(): void {
    this.conversions.register('QUOTATION', (user, lead, customer) =>
      this.quotations.createFromLead(user, lead, customer),
    );
    this.conversions.register('ORDER', (user, lead, customer) =>
      this.orders.createFromLead(user, lead, customer),
    );
    registerOrderRules(this.workflowRegistry, this.settings);
    this.search.register(orderSearch(this.prisma, this.cls));
    this.search.register(quotationSearch(this.prisma, this.cls));
    this.links.register('ORDER', {
      viewPermission: 'order:view',
      editPermission: 'order:edit',
      resolve: async (user, id) => {
        const order = await this.orders.row(user, id);
        return { orderId: id, customerId: order.customerId, leadId: order.leadId ?? undefined };
      },
    });
    this.links.register('QUOTATION', {
      viewPermission: 'quotation:view',
      editPermission: 'quotation:edit',
      resolve: async (_user, id) => {
        const q = await this.quotations.get(id);
        return { customerId: q.customerId ?? undefined, leadId: q.leadId ?? undefined };
      },
    });
  }
}
