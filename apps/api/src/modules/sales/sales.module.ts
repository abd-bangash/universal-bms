import { Module, type OnModuleInit } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { LeadConversionRegistry } from '../crm/lead-conversion.registry';
import { DocumentLinesService } from './document-lines.service';
import { OrderFactory } from './order-factory.service';
import { QuotationExpiryScheduler } from './quotation-expiry.scheduler';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';

/** Quotations (task 34), Orders (35), documents (36). */
@Module({
  imports: [CrmModule],
  controllers: [QuotationsController],
  providers: [DocumentLinesService, OrderFactory, QuotationsService, QuotationExpiryScheduler],
  exports: [QuotationsService, OrderFactory, DocumentLinesService],
})
export class SalesModule implements OnModuleInit {
  constructor(
    private readonly conversions: LeadConversionRegistry,
    private readonly quotations: QuotationsService,
  ) {}

  onModuleInit(): void {
    this.conversions.register('QUOTATION', (user, lead, customer) =>
      this.quotations.createFromLead(user, lead, customer),
    );
  }
}
