import { Module, type OnModuleInit } from '@nestjs/common';
import { D } from '../../common/money';
import { CrmModule } from '../crm/crm.module';
import { SalesModule } from '../sales/sales.module';
import { ProfileSectionRegistry, WorkspaceDefaultsRegistry } from '../tenants/registries';
import { WorkflowRegistry } from '../workflows/workflow.registry';
import { ValidationFailedException } from '../../common/errors/app.exception';
import { applyProfileExpenseCategories, ensureFinanceDefaults } from './finance-defaults';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { FinanceSettingsController } from './finance-settings.controller';
import { FinanceSettingsService } from './finance-settings.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/** Accounts, payment methods, payments, credit and expenses (tasks 39 to 43). */
@Module({
  imports: [SalesModule, CrmModule],
  controllers: [FinanceSettingsController, PaymentsController, ExpensesController],
  providers: [FinanceSettingsService, PaymentsService, ExpensesService],
  exports: [PaymentsService, FinanceSettingsService, ExpensesService],
})
export class FinanceModule implements OnModuleInit {
  constructor(
    private readonly defaults: WorkspaceDefaultsRegistry,
    private readonly sections: ProfileSectionRegistry,
    private readonly workflowRegistry: WorkflowRegistry,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit(): void {
    this.defaults.register('finance', (tx, ctx) => ensureFinanceDefaults(tx, ctx.workspaceId));
    this.sections.register('expenseCategories', applyProfileExpenseCategories);

    // Cancelling an order that has been paid needs a decision about the money. Refunds in cash
    // arrive in Release 3; until then the money can be kept as the customer's credit.
    const netPaid = (order: {
      paidAmount: { toFixed(): string };
      refundedAmount: { toFixed(): string };
    }) => D(order.paidAmount.toFixed()).minus(order.refundedAmount.toFixed());
    this.workflowRegistry.registerPrecondition(
      'ORDER',
      'CANCELLED',
      async ({ tx, record, data }) => {
        const order = await tx.order.findFirstOrThrow({ where: { id: record.id } });
        if (netPaid(order).gt(0) && data.paymentDecision !== 'CREDIT') {
          throw new ValidationFailedException({
            paymentDecision: [
              `${netPaid(order).toFixed()} has been paid on this order; choose what happens to it`,
            ],
          });
        }
      },
    );
    this.workflowRegistry.registerSideEffect(
      'ORDER',
      'CANCELLED',
      async ({ tx, record, actor }) => {
        const order = await tx.order.findFirstOrThrow({ where: { id: record.id } });
        const owed = netPaid(order);
        if (!owed.gt(0)) return;
        await this.payments.refundToCredit(
          tx,
          { userId: actor.userId, workspaceId: order.workspaceId },
          order,
          owed.toFixed(),
          'REFUND_TO_CREDIT',
        );
      },
    );
  }
}
