import { AppException, ValidationFailedException } from '../../common/errors/app.exception';
import type { WorkflowRegistry } from '../workflows/workflow.registry';
import type { WorkflowEntityAdapter } from '../workflows/workflow.types';

/** How the workflow engine reads and writes a Purchase_Order's status. */
export const purchaseWorkflowAdapter: WorkflowEntityAdapter = {
  entityType: 'PURCHASE_ORDER',
  async load(tx, id) {
    const po = await tx.purchaseOrder.findFirst({ where: { id } });
    if (!po) return null;
    return {
      id,
      stateKey: po.status,
      values: {
        supplierId: po.supplierId,
        totalAmount: po.totalAmount.toFixed(),
        ...(po.expectedDate ? { expectedDate: po.expectedDate } : {}),
        ...(po.customFields as Record<string, unknown>),
      },
    };
  },
  async setState(tx, id, state) {
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: state.key, version: { increment: 1 } },
    });
  },
};

/** Roles that only a goods receipt may set (Requirement 27.3). */
export const RECEIPT_ROLES = ['PARTIALLY_RECEIVED', 'RECEIVED'] as const;

export function registerPurchaseRules(registry: WorkflowRegistry): void {
  registry.registerAdapter(purchaseWorkflowAdapter);

  // SENT: there is something to order and someone to order it from
  registry.registerPrecondition('PURCHASE_ORDER', 'SENT', async ({ tx, record }) => {
    const po = await tx.purchaseOrder.findFirstOrThrow({
      where: { id: record.id },
      include: { supplier: true },
    });
    if (po.supplier.status !== 'ACTIVE') {
      throw new ValidationFailedException({ supplierId: ['this supplier is archived'] });
    }
    if ((await tx.purchaseOrderItem.count({ where: { purchaseOrderId: record.id } })) === 0) {
      throw new ValidationFailedException({ lines: ['add at least one line first'] });
    }
  });

  // CANCELLED: only an order nothing has arrived for
  registry.registerPrecondition('PURCHASE_ORDER', 'CANCELLED', async ({ tx, record }) => {
    const received = await tx.purchaseOrderItem.count({
      where: { purchaseOrderId: record.id, receivedQty: { gt: 0 } },
    });
    if (received > 0) {
      throw new AppException(
        'VALIDATION_FAILED',
        422,
        'Goods have already been received for this order; it cannot be cancelled',
      );
    }
  });
}
