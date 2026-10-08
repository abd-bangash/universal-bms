import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { D, sum, toJsonString } from '../../common/money';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WorkflowService } from '../workflows/workflow.service';

const DAY_MS = 86_400_000;
const DEFAULT_RANGE_DAYS = 90;

export interface LeadAnalytics {
  range: { from: string; to: string };
  byStage: Array<{ stage: string; label: string; count: number; value: string }>;
  avgDaysInStage: Array<{ stage: string; label: string; avgDays: string; samples: number }>;
  conversion: { total: number; won: number; rate: string };
  topLostReasons: Array<{ reasonId: string; name: string; count: number }>;
}

/** Pipeline analytics (Requirement 9.6) over the leads created in a period. */
@Injectable()
export class LeadAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowService,
  ) {}

  async compute(user: AuthUser, range: { from?: string; to?: string }): Promise<LeadAnalytics> {
    const to = range.to ? new Date(range.to) : new Date();
    const from = range.from
      ? new Date(range.from)
      : new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
    const workflow = await this.workflows.get('LEAD');
    const stateOf = new Map(workflow.states.map((s) => [s.key, s]));
    const visible = user.permissions.includes('lead:view_all')
      ? {}
      : { OR: [{ assignedToId: user.userId }, { createdById: user.userId }] };

    const leads = await this.prisma.scoped.lead.findMany({
      where: { AND: [visible, { createdAt: { gte: from, lte: to } }] },
      select: { id: true, stage: true, estimatedValue: true, lostReasonId: true },
    });

    // count and value by stage, in pipeline order
    const byStage = workflow.states
      .filter((s) => s.active)
      .map((s) => {
        const inStage = leads.filter((l) => l.stage === s.key);
        return {
          stage: s.key,
          label: s.label,
          count: inStage.length,
          value: toJsonString(sum(inStage.map((l) => l.estimatedValue?.toFixed() ?? '0'))),
        };
      });

    // average time in each open stage, from the status history (the first row is the lead's creation)
    const history = await this.prisma.scoped.statusHistory.findMany({
      where: { entityType: 'LEAD', entityId: { in: leads.map((l) => l.id) } },
      orderBy: [{ entityId: 'asc' }, { createdAt: 'asc' }],
    });
    const spent = new Map<string, number[]>();
    const now = Date.now();
    const rowsByLead = new Map<string, typeof history>();
    for (const row of history)
      rowsByLead.set(row.entityId, [...(rowsByLead.get(row.entityId) ?? []), row]);
    for (const rows of rowsByLead.values()) {
      rows.forEach((row, i) => {
        const state = stateOf.get(row.toKey);
        if (!state || state.category === 'DONE' || state.category === 'CANCELLED') return;
        const leftAt = rows[i + 1]?.createdAt.getTime() ?? now;
        spent.set(row.toKey, [
          ...(spent.get(row.toKey) ?? []),
          Math.max(0, leftAt - row.createdAt.getTime()),
        ]);
      });
    }
    const avgDaysInStage = workflow.states
      .filter((s) => s.active && s.category !== 'DONE' && s.category !== 'CANCELLED')
      .map((s) => {
        const samples = spent.get(s.key) ?? [];
        const avg =
          samples.length === 0
            ? D(0)
            : D(samples.reduce((a, b) => a + b, 0))
                .div(samples.length)
                .div(DAY_MS);
        return {
          stage: s.key,
          label: s.label,
          avgDays: avg.toDecimalPlaces(2).toFixed(),
          samples: samples.length,
        };
      });

    // conversion: leads that reached a Won state, of all leads created in the period
    const wonKeys = new Set(
      workflow.states.filter((s) => s.systemRole === 'WON').map((s) => s.key),
    );
    const won = leads.filter((l) => wonKeys.has(l.stage)).length;
    const rate = leads.length === 0 ? D(0) : D(won).div(leads.length);

    const lostCounts = new Map<string, number>();
    for (const l of leads)
      if (l.lostReasonId) lostCounts.set(l.lostReasonId, (lostCounts.get(l.lostReasonId) ?? 0) + 1);
    const reasons = await this.prisma.scoped.lostReason.findMany({
      where: { id: { in: [...lostCounts.keys()] } },
    });
    const topLostReasons = [...lostCounts.entries()]
      .map(([reasonId, count]) => ({
        reasonId,
        name: reasons.find((r) => r.id === reasonId)?.name ?? 'Unknown',
        count,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 5);

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      byStage,
      avgDaysInStage,
      conversion: { total: leads.length, won, rate: rate.toDecimalPlaces(4).toFixed() },
      topLostReasons,
    };
  }
}
