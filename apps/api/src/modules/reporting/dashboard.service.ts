import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { addDays, localDay, localDayStart } from './report-dates';
import { ReportingService } from './reporting.service';
import type { ReportQuery, ReportResult } from './reporting.types';

export interface Dashboard {
  generatedAt: string;
  timezone: string;
  /** Only the indicators this person may see are present (Requirement 19.1, 19.8). */
  salesToday?: SalesFigure;
  salesWeek?: SalesFigure;
  salesMonth?: SalesFigure;
  openOrders?: Array<{ status: string; label: string; count: number }>;
  leadFunnel?: Array<{ stage: string; label: string; count: number }>;
  lowStock?: { count: number };
  outstandingBalances?: { customers: number; total: string };
  pendingCommissions?: { count: number; amount?: string };
  myTasks?: {
    overdue: number;
    today: number;
    items: Array<{ id: string; title: string; dueAt: string | null }>;
  };
}

interface SalesFigure {
  orders: number;
  total: string;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly reports: ReportingService,
  ) {}

  async forUser(user: AuthUser): Promise<Dashboard> {
    const timezone = await this.settings.get<string>('locale.timezone');
    const has = (permission: string) => user.permissions.includes(permission);
    const result: Dashboard = { generatedAt: new Date().toISOString(), timezone };

    const run = async (key: string, query: ReportQuery): Promise<ReportResult | null> => {
      try {
        return await this.reports.run(user, key, query);
      } catch (err) {
        if (err instanceof AppException && err.getStatus() === 403) return null;
        throw err;
      }
    };
    const sales = async (range: 'today' | 'week' | 'month'): Promise<SalesFigure | undefined> => {
      const report = await run('sales-by-date', { range });
      return report
        ? { orders: Number(report.totals['orders'] ?? 0), total: report.totals['total'] ?? '0' }
        : undefined;
    };

    const [today, week, month, funnel, low, owing] = await Promise.all([
      sales('today'),
      sales('week'),
      sales('month'),
      run('lead-pipeline', {}),
      run('low-stock', {}),
      run('customer-balances', {}),
    ]);
    if (today) result.salesToday = today;
    if (week) result.salesWeek = week;
    if (month) result.salesMonth = month;
    if (funnel) {
      result.leadFunnel = funnel.rows.map((r) => ({
        stage: r.key,
        label: String(r['stage']),
        count: Number(r['leads']),
      }));
    }
    if (low) result.lowStock = { count: low.rows.length };
    if (owing) {
      result.outstandingBalances = {
        customers: owing.rows.length,
        total: owing.totals['balance'] ?? '0',
      };
    }

    if (has('order:view')) result.openOrders = await this.openOrders(user);
    if (has('commission:view')) result.pendingCommissions = await this.pendingCommissions(user);
    if (has('task:view')) result.myTasks = await this.myTasks(user, timezone);
    return result;
  }

  /** Orders that are still being worked on, by status, in the workflow's order. */
  private async openOrders(user: AuthUser) {
    const scope = user.permissions.includes('order:view_all')
      ? Prisma.empty
      : Prisma.sql`AND (o.assigned_to_id = ${user.userId} OR o.created_by_id = ${user.userId})`;
    const rows = await this.prisma.scoped.$queryRaw<
      Array<{ status: string; label: string; count: number }>
    >`
      SELECT o.status, COALESCE(MAX(s.label), o.status) AS label, COUNT(*)::int AS count
      FROM orders o
      JOIN workflows w ON w.workspace_id = o.workspace_id AND w.entity_type = 'ORDER'::workflow_entity
      JOIN workflow_states s ON s.workflow_id = w.id AND s.key = o.status
      WHERE o.workspace_id = ${user.workspaceId} AND s.category IN ('OPEN', 'IN_PROGRESS') ${scope}
      GROUP BY o.status ORDER BY COALESCE(MAX(s.sort_order), 999), 2`;
    return rows;
  }

  /** The amount is a payment figure and only shown with `report:financial`; anyone may see how many are waiting. */
  private async pendingCommissions(user: AuthUser) {
    const where: Prisma.CommissionWhereInput = {
      status: 'PENDING',
      ...(user.permissions.includes('commission:view_all') ? {} : { salespersonId: user.userId }),
    };
    const sum = await this.prisma.scoped.commission.aggregate({
      where,
      _count: true,
      _sum: { amount: true },
    });
    return {
      count: sum._count,
      ...(user.permissions.includes('report:financial')
        ? { amount: new Decimal(sum._sum.amount?.toFixed() ?? '0').toString() }
        : {}),
    };
  }

  /** The person's own open tasks that are overdue or due today, soonest first. */
  private async myTasks(user: AuthUser, timezone: string) {
    const today = localDay(new Date(), timezone);
    const startOfToday = localDayStart(today, timezone);
    const endOfToday = localDayStart(addDays(today, 1), timezone);
    const open = { assignedToId: user.userId, status: 'OPEN' as const };
    const [overdue, dueToday, items] = await Promise.all([
      this.prisma.scoped.task.count({ where: { ...open, dueAt: { lt: startOfToday } } }),
      this.prisma.scoped.task.count({
        where: { ...open, dueAt: { gte: startOfToday, lt: endOfToday } },
      }),
      this.prisma.scoped.task.findMany({
        where: { ...open, dueAt: { lt: endOfToday } },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        take: 5,
        select: { id: true, title: true, dueAt: true },
      }),
    ]);
    return {
      overdue,
      today: dueToday,
      items: items.map((t) => ({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt ? t.dueAt.toISOString() : null,
      })),
    };
  }
}
