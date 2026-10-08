import { AppException, ValidationFailedException } from '../../common/errors/app.exception';
import type { WorkflowRegistry } from '../workflows/workflow.registry';
import type { WorkflowEntityAdapter } from '../workflows/workflow.types';

/** How the workflow engine reads and writes a Lead's stage. */
export const leadWorkflowAdapter: WorkflowEntityAdapter = {
  entityType: 'LEAD',
  event: 'lead.status_changed',
  async load(tx, id) {
    const lead = await tx.lead.findFirst({ where: { id } });
    if (!lead) return null;
    return {
      id,
      stateKey: lead.stage,
      values: {
        fullName: lead.fullName,
        phone: lead.phone,
        email: lead.email,
        interest: lead.interest,
        requirements: lead.requirements,
        productId: lead.productId,
        quantity: lead.quantity?.toFixed() ?? null,
        estimatedValue: lead.estimatedValue?.toFixed() ?? null,
        assignedToId: lead.assignedToId,
        lostReasonId: lead.lostReasonId,
        ...(lead.customFields as Record<string, unknown>),
      },
    };
  },
  async setState(tx, id, state) {
    const closing = state.category === 'DONE' || state.category === 'CANCELLED';
    await tx.lead.update({
      where: { id },
      data: {
        stage: state.key,
        version: { increment: 1 },
        // moving back to an open stage reopens the lead
        ...(closing ? {} : { closedAt: null, lostReasonId: null }),
      },
    });
  },
};

/**
 * Business rules attached to System_Roles (design.md): WON and LOST close the lead; LOST needs a
 * reason from the workspace's list, which is stored on the lead.
 */
export function registerLeadRules(registry: WorkflowRegistry): void {
  registry.registerAdapter(leadWorkflowAdapter);

  registry.registerPrecondition('LEAD', 'LOST', async ({ tx, data }) => {
    const id = typeof data.lostReasonId === 'string' ? data.lostReasonId : '';
    if (!id) {
      throw new ValidationFailedException({ lostReasonId: ['choose why the lead was lost'] });
    }
    const reason = await tx.lostReason.findFirst({ where: { id, active: true } });
    if (!reason)
      throw new ValidationFailedException({ lostReasonId: ['is not an available reason'] });
  });

  registry.registerSideEffect('LEAD', 'LOST', async ({ tx, record, data }) => {
    await tx.lead.update({
      where: { id: record.id },
      data: { lostReasonId: data.lostReasonId as string, closedAt: new Date() },
    });
  });

  registry.registerSideEffect('LEAD', 'WON', async ({ tx, record }) => {
    await tx.lead.update({ where: { id: record.id }, data: { closedAt: new Date() } });
  });
}

export const staleLead = () =>
  new AppException(
    'STALE_VERSION',
    409,
    'This lead was changed by someone else; reload and try again',
  );
