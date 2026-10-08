import { CommissionsService } from '../../modules/commissions/commissions.service';
import type { DemoContext, DemoStep, StepResult } from '../demo-seed';

/**
 * The commissions the orders earned are already there (the sales step completed them). This step
 * shows the rest of the life of a commission: one paid, one still waiting, and more when there are more.
 */
export const commissionsStep: DemoStep = {
  name: 'commissions',
  async run(ctx: DemoContext): Promise<StepResult> {
    const { unscoped } = ctx.prisma;
    const decided = await unscoped.commission.count({
      where: { workspaceId: ctx.workspaceId, status: { not: 'PENDING' } },
    });
    if (decided > 0) return { created: 0, existing: decided };

    const pending = await unscoped.commission.findMany({
      where: { workspaceId: ctx.workspaceId, status: 'PENDING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const service = ctx.get(CommissionsService);
    let changed = 0;
    await ctx.asOwner(async (owner) => {
      // the first is approved and paid, the second waits, the third is approved, the fourth rejected
      const [first, , third, fourth] = pending;
      if (first) {
        await service.approve(owner, first.id);
        await service.pay(owner, first.id, { method: 'Bank transfer' });
        changed += 2;
      }
      if (third) {
        await service.approve(owner, third.id);
        changed += 1;
      }
      if (fourth) {
        await service.reject(owner, fourth.id, 'Order was split between two people');
        changed += 1;
      }
    });
    return { created: changed, existing: 0 };
  },
};
