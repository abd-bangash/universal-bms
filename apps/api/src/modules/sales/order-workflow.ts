import { AppException, ValidationFailedException } from '../../common/errors/app.exception';
import { D, roundHalfUp } from '../../common/money';
import type { SettingsService } from '../settings/settings.service';
import type { WorkflowRegistry } from '../workflows/workflow.registry';
import type { WorkflowEntityAdapter } from '../workflows/workflow.types';

/** How the workflow engine reads and writes an Order's status. */
export const orderWorkflowAdapter: WorkflowEntityAdapter = {
  entityType: 'ORDER',
  event: 'order.status_changed',
  async load(tx, id) {
    const order = await tx.order.findFirst({ where: { id } });
    if (!order) return null;
    return {
      id,
      stateKey: order.status,
      values: {
        customerId: order.customerId,
        totalAmount: order.totalAmount.toFixed(),
        ...(order.fulfilmentMethod ? { fulfilmentMethod: order.fulfilmentMethod } : {}),
        ...(order.scheduledAt ? { scheduledAt: order.scheduledAt } : {}),
        ...(order.deliveryAddress ? { deliveryAddress: order.deliveryAddress } : {}),
        ...(order.receiverName ? { receiverName: order.receiverName } : {}),
        ...(order.proofFileId ? { proofFileId: order.proofFileId } : {}),
        ...(order.deliveredAt ? { deliveredAt: order.deliveredAt } : {}),
        ...(order.cancelReason ? { cancelReason: order.cancelReason } : {}),
        ...(order.customFields as Record<string, unknown>),
      },
    };
  },
  async setState(tx, id, state) {
    await tx.order.update({
      where: { id },
      data: { status: state.key, version: { increment: 1 } },
    });
  },
};

/**
 * Business rules attached to the System_Roles of an Order (design.md, WorkflowService). Stock
 * effects are added by task 47, production jobs by Release 3 and commissions by task 60.
 */
export function registerOrderRules(registry: WorkflowRegistry, settings: SettingsService): void {
  registry.registerAdapter(orderWorkflowAdapter);

  // CONFIRMED: there is something to sell and someone to sell it to (Requirement 11)
  registry.registerPrecondition('ORDER', 'CONFIRMED', async ({ tx, record }) => {
    const order = await tx.order.findFirstOrThrow({ where: { id: record.id } });
    if (!order.customerId)
      throw new ValidationFailedException({ customerId: ['choose a customer first'] });
    const lines = await tx.orderItem.count({ where: { orderId: record.id } });
    if (lines === 0)
      throw new ValidationFailedException({ lines: ['add at least one line first'] });
  });

  // The deposit is fixed when the order is confirmed, from the percentage then in force (39.5)
  registry.registerSideEffect('ORDER', 'CONFIRMED', async ({ tx, record }) => {
    const [percent, decimals] = await Promise.all([
      settings.get<number>('sales.requiredDepositPercent'),
      settings.get<number>('locale.currencyDecimals'),
    ]);
    const order = await tx.order.findFirstOrThrow({ where: { id: record.id } });
    const deposit = roundHalfUp(D(order.totalAmount.toFixed()).mul(percent).div(100), decimals);
    await tx.order.update({
      where: { id: record.id },
      data: { depositRequired: deposit.toFixed() },
    });
  });

  // IN_PRODUCTION: confirmed payments must reach the required deposit unless overridden (39.5)
  registry.registerPrecondition('ORDER', 'IN_PRODUCTION', async ({ tx, record, actor }) => {
    const order = await tx.order.findFirstOrThrow({ where: { id: record.id } });
    const required = D(order.depositRequired.toFixed());
    const netPaid = D(order.paidAmount.toFixed()).minus(order.refundedAmount.toFixed());
    if (
      required.gt(0) &&
      netPaid.lt(required) &&
      !actor.permissions.includes('order:deposit_override')
    ) {
      throw new AppException(
        'DEPOSIT_REQUIRED',
        422,
        `A deposit of ${required.toFixed()} is required before production; ${netPaid.toFixed()} has been paid`,
        undefined,
        { required: required.toFixed(), paid: netPaid.toFixed() },
      );
    }
  });

  // DELIVERED: the delivery date is recorded if the team did not
  registry.registerSideEffect('ORDER', 'DELIVERED', async ({ tx, record, actor }) => {
    const order = await tx.order.findFirstOrThrow({ where: { id: record.id } });
    await tx.order.update({
      where: { id: record.id },
      data: {
        deliveredAt: order.deliveredAt ?? new Date(),
        deliveredById: order.deliveredById ?? actor.userId,
      },
    });
  });

  // COMPLETED: nothing owed, or the override permission; records the closing time (39.10)
  registry.registerPrecondition('ORDER', 'COMPLETED', async ({ tx, record, actor }) => {
    const order = await tx.order.findFirstOrThrow({ where: { id: record.id } });
    if (
      D(order.balanceDue.toFixed()).gt(0) &&
      !actor.permissions.includes('order:complete_with_balance')
    ) {
      throw new AppException(
        'BALANCE_DUE',
        422,
        `This order still has a balance of ${order.balanceDue.toFixed()}`,
        undefined,
        { balanceDue: order.balanceDue.toFixed() },
      );
    }
  });
  registry.registerSideEffect('ORDER', 'COMPLETED', async ({ tx, record }) => {
    await tx.order.update({ where: { id: record.id }, data: { closedAt: new Date() } });
  });

  // CANCELLED: a reason is kept on the order
  registry.registerPrecondition('ORDER', 'CANCELLED', async ({ data }) => {
    const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
    if (!reason)
      throw new ValidationFailedException({ reason: ['say why the order is cancelled'] });
  });
  registry.registerSideEffect('ORDER', 'CANCELLED', async ({ tx, record, data }) => {
    await tx.order.update({
      where: { id: record.id },
      data: {
        cancelledAt: new Date(),
        cancelReason: String(data.reason).trim(),
        closedAt: new Date(),
      },
    });
  });
}
