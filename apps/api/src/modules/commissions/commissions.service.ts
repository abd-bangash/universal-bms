import { Injectable } from '@nestjs/common';
import type { Commission, CommissionRule, Prisma } from '@prisma/client';
import {
  calculateCommissions,
  type CommissionLineInput,
  type CommissionRuleInput,
} from '@bms/calc';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { D, roundHalfUp } from '../../common/money';
import { keysetCursor, keysetWhere, Page, toPage } from '../../common/pagination/pagination';
import { PrismaService, type ScopedTransaction } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import type {
  CreateRuleDto,
  ListCommissionsQuery,
  PayCommissionDto,
  UpdateRuleDto,
} from './dto/commissions.dto';

export interface CommissionDto {
  id: string;
  orderId: string;
  orderNumber: string;
  orderItemId: string | null;
  salespersonId: string;
  salespersonName: string;
  ruleId: string | null;
  ruleName: string | null;
  calculationBase: string;
  sharePercent: string;
  amount: string;
  status: string;
  reversalOfId: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  paidMethod: string | null;
  note: string | null;
  createdAt: string;
}

export interface RuleDto {
  id: string;
  name: string;
  calcType: string;
  rate: string;
  baseType: string;
  scope: string;
  scopeId: string | null;
  salespersonId: string | null;
  priority: number;
  active: boolean;
  createdAt: string;
}

export const STAFF_RULE_NAME = 'Staff commission';
const refuse = (message: string, details?: Record<string, string[]>) =>
  new AppException('VALIDATION_FAILED', 422, message, details);

const toRuleDto = (r: CommissionRule): RuleDto => ({
  id: r.id,
  name: r.name,
  calcType: r.calcType,
  rate: r.rate.toFixed(),
  baseType: r.baseType,
  scope: r.scope,
  scopeId: r.scopeId,
  salespersonId: r.salespersonId,
  priority: r.priority,
  active: r.active,
  createdAt: r.createdAt.toISOString(),
});

type CommissionRow = Commission & {
  order: { orderNumber: string };
  salesperson: { firstName: string; lastName: string };
};

const toDto = (c: CommissionRow): CommissionDto => ({
  id: c.id,
  orderId: c.orderId,
  orderNumber: c.order.orderNumber,
  orderItemId: c.orderItemId,
  salespersonId: c.salespersonId,
  salespersonName: `${c.salesperson.firstName} ${c.salesperson.lastName}`.trim(),
  ruleId: c.ruleId,
  ruleName: (c.ruleSnapshot as { name?: string } | null)?.name ?? null,
  calculationBase: c.calculationBase.toFixed(),
  sharePercent: c.sharePercent.toFixed(),
  amount: c.amount.toFixed(),
  status: c.status,
  reversalOfId: c.reversalOfId,
  approvedById: c.approvedById,
  approvedAt: c.approvedAt ? c.approvedAt.toISOString() : null,
  paidAt: c.paidAt ? c.paidAt.toISOString() : null,
  paidMethod: c.paidMethod,
  note: c.note,
  createdAt: c.createdAt.toISOString(),
});

const include = {
  order: { select: { orderNumber: true } },
  salesperson: { select: { firstName: true, lastName: true } },
} as const;

@Injectable()
export class CommissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  // ── calculation (design.md, Commissions) ────────────────────────────────────────────────

  /**
   * Creates the PENDING commissions of an order, once. Calling it again for the same order does
   * nothing, so a repeated event or a retried job cannot pay twice. Returns the rows created.
   */
  async calculateForOrder(orderId: string): Promise<number> {
    if (!(await this.settings.get<boolean>('modules.commissions'))) return 0;
    const decimals = await this.settings.get<number>('locale.currencyDecimals');
    return this.prisma.scoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.order.findFirst({
        where: { id: orderId },
        include: { items: { orderBy: { lineNo: 'asc' } }, salespeople: true },
      });
      if (!order) return 0;
      if ((await tx.commission.count({ where: { orderId } })) > 0) return 0;

      const salespeople = order.salespeople.length
        ? order.salespeople.map((s) => ({
            userId: s.userId,
            sharePercent: s.sharePercent.toFixed(),
          }))
        : order.assignedToId
          ? [{ userId: order.assignedToId, sharePercent: '100' }]
          : [];
      if (salespeople.length === 0) return 0;

      const rules = await tx.commissionRule.findMany({ where: { active: true } });
      if (rules.length === 0) return 0;
      const categoriesOf = await this.categoryChains(
        tx,
        order.items.map((i) => i.productId),
      );
      const lines: CommissionLineInput[] = order.items.map((i) => ({
        key: i.id,
        lineNo: i.lineNo,
        productId: i.productId,
        categoryIds: categoriesOf(i.productId),
        quantity: i.quantity.toFixed(),
        unitPrice: i.unitPrice.toFixed(),
        netAmount: D(i.lineTotal.toFixed()).minus(i.taxAmount.toFixed()).toFixed(),
        costPrice: i.costPrice ? i.costPrice.toFixed() : null,
      }));
      const inputs: CommissionRuleInput[] = rules.map((r) => ({
        id: r.id,
        calcType: r.calcType,
        rate: r.rate.toFixed(),
        baseType: r.baseType,
        scope: r.scope as CommissionRuleInput['scope'],
        scopeId: r.scopeId,
        salespersonId: r.salespersonId,
        priority: r.priority,
        createdAt: r.createdAt.getTime(),
      }));
      const rows = calculateCommissions({
        rules: inputs,
        lines,
        salespeople,
        orderType: order.orderType,
        currencyDecimals: decimals,
      });
      if (rows.length === 0) return 0;

      const created = await tx.commission.createMany({
        skipDuplicates: true,
        data: rows.map((row) => {
          const source = rules.find((r) => r.id === row.rule.id) as CommissionRule;
          return {
            workspaceId: order.workspaceId,
            orderId,
            orderItemId: row.lineKey,
            salespersonId: row.salespersonId,
            ruleId: row.rule.id,
            ruleSnapshot: {
              name: source.name,
              calcType: source.calcType,
              rate: source.rate.toFixed(),
              baseType: source.baseType,
              scope: source.scope,
              scopeId: source.scopeId,
              salespersonId: source.salespersonId,
              priority: source.priority,
            },
            calculationBase: row.calculationBase,
            sharePercent: row.sharePercent,
            amount: row.amount,
          };
        }),
      });
      await this.audit.record(tx, {
        action: 'commission.calculate',
        entityType: 'Order',
        entityId: orderId,
        after: {
          orderNumber: order.orderNumber,
          rows: created.count,
          total: rows.reduce((sum, r) => sum.plus(r.amount), D(0)).toFixed(),
        },
      });
      return created.count;
    });
  }

  /**
   * Every commission of a cancelled order becomes REVERSED, whatever its status was, paid ones
   * included (Requirement 14.6). A rejected commission stays rejected: nothing was ever owed.
   * Runs inside the cancelling transaction.
   */
  async reverseForOrder(tx: ScopedTransaction, orderId: string): Promise<number> {
    const rows = await tx.commission.findMany({
      where: { orderId, reversalOfId: null, status: { in: ['PENDING', 'APPROVED', 'PAID'] } },
    });
    if (rows.length === 0) return 0;
    await tx.commission.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: 'REVERSED' },
    });
    await this.audit.record(tx, {
      action: 'commission.reverse',
      entityType: 'Order',
      entityId: orderId,
      before: {
        statuses: rows.map((r) => ({ id: r.id, status: r.status, amount: r.amount.toFixed() })),
      },
      after: { status: 'REVERSED' },
    });
    return rows.length;
  }

  // ── the statement and its decisions (Requirements 14.4, 14.5, 14.7) ─────────────────────

  async list(user: AuthUser, query: ListCommissionsQuery): Promise<Page<CommissionDto>> {
    const filters: Prisma.CommissionWhereInput[] = [];
    const seesAll = user.permissions.includes('commission:view_all');
    if (!seesAll) filters.push({ salespersonId: user.userId });
    else if (query.salespersonId) filters.push({ salespersonId: query.salespersonId });
    if (!seesAll && query.salespersonId && query.salespersonId !== user.userId) {
      return new Page<CommissionDto>([]);
    }
    if (query.status) filters.push({ status: query.status });
    if (query.orderId) filters.push({ orderId: query.orderId });
    if (query.from) filters.push({ createdAt: { gte: new Date(query.from) } });
    if (query.to) filters.push({ createdAt: { lte: new Date(query.to) } });
    const after = keysetWhere('createdAt', 'desc', query.cursor, true);
    if (after) filters.push(after as Prisma.CommissionWhereInput);
    const rows = await this.prisma.scoped.commission.findMany({
      where: { AND: filters },
      include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) => keysetCursor(last.createdAt, last.id)).map(toDto);
  }

  approve(user: AuthUser, id: string) {
    return this.decide(user, id, 'APPROVED');
  }

  reject(user: AuthUser, id: string, reason?: string) {
    return this.decide(user, id, 'REJECTED', reason);
  }

  private async decide(
    user: AuthUser,
    id: string,
    status: 'APPROVED' | 'REJECTED',
    note?: string,
  ): Promise<CommissionDto> {
    return this.prisma.scoped.$transaction(async (tx) => {
      const current = await this.lockRow(tx, id);
      if (current.status !== 'PENDING') {
        throw refuse(
          `Only a pending commission can be ${status.toLowerCase()}; this one is ${current.status.toLowerCase()}`,
        );
      }
      const row = await tx.commission.update({
        where: { id },
        data: {
          status,
          approvedById: user.userId,
          approvedAt: new Date(),
          note: note?.trim() || null,
        },
        include,
      });
      await this.audit.record(tx, {
        action: status === 'APPROVED' ? 'commission.approve' : 'commission.reject',
        entityType: 'Commission',
        entityId: id,
        before: { status: current.status },
        after: { status, amount: current.amount.toFixed() },
      });
      return toDto(row);
    });
  }

  async pay(user: AuthUser, id: string, dto: PayCommissionDto): Promise<CommissionDto> {
    return this.prisma.scoped.$transaction(async (tx) => {
      const current = await this.lockRow(tx, id);
      if (current.status !== 'APPROVED') {
        throw refuse(
          `Only an approved commission can be paid; this one is ${current.status.toLowerCase()}`,
        );
      }
      const row = await tx.commission.update({
        where: { id },
        data: {
          status: 'PAID',
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          paidMethod: dto.method.trim(),
          note: dto.note?.trim() || current.note,
        },
        include,
      });
      await this.audit.record(tx, {
        action: 'commission.pay',
        entityType: 'Commission',
        entityId: id,
        before: { status: current.status },
        after: { status: 'PAID', method: dto.method.trim(), amount: current.amount.toFixed() },
        metadata: { paidBy: user.userId },
      });
      return toDto(row);
    });
  }

  // ── rules (Requirement 14.1, 41.4) ──────────────────────────────────────────────────────

  async rules(): Promise<RuleDto[]> {
    const rows = await this.prisma.scoped.commissionRule.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toRuleDto);
  }

  async createRule(user: AuthUser, dto: CreateRuleDto): Promise<RuleDto> {
    const data = await this.checkedRule({
      name: dto.name.trim(),
      calcType: dto.calcType,
      rate: dto.rate,
      baseType: dto.baseType ?? 'NET_SALES',
      scope: dto.scope ?? 'ALL',
      scopeId: dto.scopeId ?? null,
      salespersonId: dto.salespersonId ?? null,
    });
    return this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.commissionRule.create({
        data: {
          workspaceId: user.workspaceId,
          ...data,
          priority: dto.priority ?? 0,
          active: dto.active ?? true,
        },
      });
      await this.audit.record(tx, {
        action: 'commission.rule_create',
        entityType: 'CommissionRule',
        entityId: row.id,
        after: toRuleDto(row) as unknown as Record<string, unknown>,
      });
      return toRuleDto(row);
    });
  }

  async updateRule(user: AuthUser, id: string, dto: UpdateRuleDto): Promise<RuleDto> {
    const existing = await this.prisma.scoped.commissionRule.findFirst({ where: { id } });
    if (!existing) throw new NotFoundAppException();
    const data = await this.checkedRule({
      name: dto.name?.trim() ?? existing.name,
      calcType: dto.calcType ?? existing.calcType,
      rate: dto.rate ?? existing.rate.toFixed(),
      baseType: dto.baseType ?? existing.baseType,
      scope: dto.scope ?? existing.scope,
      scopeId: dto.scopeId === undefined ? existing.scopeId : dto.scopeId,
      salespersonId: dto.salespersonId === undefined ? existing.salespersonId : dto.salespersonId,
    });
    void user;
    return this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.commissionRule.update({
        where: { id },
        data: { ...data, priority: dto.priority, active: dto.active },
      });
      await this.audit.record(tx, {
        action: 'commission.rule_update',
        entityType: 'CommissionRule',
        entityId: id,
        before: toRuleDto(existing) as unknown as Record<string, unknown>,
        after: toRuleDto(row) as unknown as Record<string, unknown>,
      });
      return toRuleDto(row);
    });
  }

  // ── the staff profile's commission percentage (design.md, Commissions) ──────────────────

  async staffPercent(userId: string): Promise<{ percent: string | null; ruleId: string | null }> {
    await this.assertMember(userId);
    const rule = await this.prisma.scoped.commissionRule.findFirst({
      where: staffRuleWhere(userId),
    });
    return { percent: rule?.active ? rule.rate.toFixed() : null, ruleId: rule?.id ?? null };
  }

  /** One percentage of net sales for a person: creates or updates their own rule (0 switches it off). */
  async setStaffPercent(user: AuthUser, userId: string, percent: string) {
    await this.assertMember(userId);
    const value = D(percent);
    if (value.isNegative() || value.gt(100)) {
      throw new ValidationFailedException({ percent: ['must be between 0 and 100'] });
    }
    return this.prisma.scoped.$transaction(async (tx) => {
      const existing = await tx.commissionRule.findFirst({ where: staffRuleWhere(userId) });
      const row = existing
        ? await tx.commissionRule.update({
            where: { id: existing.id },
            data: { rate: value.toFixed(), active: value.gt(0) },
          })
        : await tx.commissionRule.create({
            data: {
              workspaceId: user.workspaceId,
              name: STAFF_RULE_NAME,
              calcType: 'PERCENTAGE',
              rate: value.toFixed(),
              baseType: 'NET_SALES',
              scope: 'ALL',
              salespersonId: userId,
              active: value.gt(0),
            },
          });
      await this.audit.record(tx, {
        action: 'commission.staff_percent',
        entityType: 'User',
        entityId: userId,
        before: { percent: existing?.active ? existing.rate.toFixed() : null },
        after: { percent: row.active ? row.rate.toFixed() : null },
      });
      return { percent: row.active ? row.rate.toFixed() : null, ruleId: row.id };
    });
  }

  // ── performance (Requirement 41.6) ──────────────────────────────────────────────────────

  async performance(userId: string, range: { from?: string; to?: string }) {
    await this.assertMember(userId);
    const createdAt = {
      ...(range.from ? { gte: new Date(range.from) } : {}),
      ...(range.to ? { lte: new Date(range.to) } : {}),
    };
    const hasRange = Object.keys(createdAt).length > 0;
    const leads = await this.prisma.scoped.lead.findMany({
      where: { assignedToId: userId, ...(hasRange ? { createdAt } : {}) },
      select: { stage: true },
    });
    const leadStates = await this.prisma.scoped.workflowState.findMany({
      where: { workflow: { entityType: 'LEAD' } },
      select: { key: true, systemRole: true },
    });
    const won = new Set(leadStates.filter((s) => s.systemRole === 'WON').map((s) => s.key));
    const leadsWon = leads.filter((l) => won.has(l.stage)).length;

    const orderStates = await this.prisma.scoped.workflowState.findMany({
      where: { workflow: { entityType: 'ORDER' } },
      select: { key: true, systemRole: true },
    });
    const counted = orderStates
      .filter((s) => s.systemRole !== 'DRAFT' && s.systemRole !== 'CANCELLED')
      .map((s) => s.key);
    const shares = await this.prisma.scoped.orderSalesperson.findMany({
      where: {
        userId,
        order: { status: { in: counted }, ...(hasRange ? { orderDate: createdAt } : {}) },
      },
      include: { order: { select: { totalAmount: true } } },
    });
    const salesValue = shares.reduce(
      (sum, s) => sum.plus(D(s.order.totalAmount.toFixed()).mul(s.sharePercent.toFixed()).div(100)),
      D(0),
    );
    const decimals = await this.settings.get<number>('locale.currencyDecimals');
    const commissions = await this.prisma.scoped.commission.groupBy({
      by: ['status'],
      where: { salespersonId: userId, ...(hasRange ? { createdAt } : {}) },
      _sum: { amount: true },
    });
    const sum = (status: string) =>
      commissions.find((c) => c.status === status)?._sum.amount?.toFixed() ?? '0';
    return {
      userId,
      from: range.from ?? null,
      to: range.to ?? null,
      leadsAssigned: leads.length,
      leadsWon,
      conversionRate: leads.length
        ? roundHalfUp(D(leadsWon).mul(100).div(leads.length), 2).toFixed()
        : '0',
      orders: shares.length,
      salesValue: roundHalfUp(salesValue, decimals).toFixed(),
      averageOrderValue: shares.length
        ? roundHalfUp(salesValue.div(shares.length), decimals).toFixed()
        : '0',
      commissionsPending: sum('PENDING'),
      commissionsApproved: sum('APPROVED'),
      commissionsPaid: sum('PAID'),
    };
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────

  private async lockRow(tx: ScopedTransaction, id: string): Promise<Commission> {
    await tx.$queryRaw`SELECT id FROM commissions WHERE id = ${id} FOR UPDATE`;
    const row = await tx.commission.findFirst({ where: { id } });
    if (!row) throw new NotFoundAppException();
    return row;
  }

  private async assertMember(userId: string): Promise<void> {
    const member = await this.prisma.scoped.userWorkspace.findFirst({ where: { userId } });
    if (!member) throw new NotFoundAppException();
  }

  /** The category of each product and all its ancestors, so a rule on a parent category applies below it. */
  private async categoryChains(
    tx: ScopedTransaction,
    productIds: Array<string | null>,
  ): Promise<(productId: string | null) => string[]> {
    const ids = [...new Set(productIds.filter((p): p is string => !!p))];
    const products = await tx.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, categoryId: true },
    });
    const categories = await tx.category.findMany({ select: { id: true, parentId: true } });
    const parent = new Map(categories.map((c) => [c.id, c.parentId]));
    const chainOf = (categoryId: string | null): string[] => {
      const chain: string[] = [];
      let current = categoryId;
      while (current && !chain.includes(current)) {
        chain.push(current);
        current = parent.get(current) ?? null;
      }
      return chain;
    };
    const byProduct = new Map(products.map((p) => [p.id, chainOf(p.categoryId)]));
    return (productId) => (productId ? (byProduct.get(productId) ?? []) : []);
  }

  private async checkedRule(rule: {
    name: string;
    calcType: CommissionRule['calcType'];
    rate: string;
    baseType: CommissionRule['baseType'];
    scope: string;
    scopeId: string | null;
    salespersonId: string | null;
  }) {
    const errors: Record<string, string[]> = {};
    const rate = D(rule.rate);
    if (rate.isNegative()) errors['rate'] = ['cannot be negative'];
    else if (rule.calcType === 'PERCENTAGE' && rate.gt(100))
      errors['rate'] = ['cannot be more than 100 percent'];
    if (rule.scope === 'ALL') {
      if (rule.scopeId) errors['scopeId'] = ['must be empty when the rule applies to everything'];
    } else if (!rule.scopeId) {
      errors['scopeId'] = ['choose what the rule applies to'];
    } else if (rule.scope === 'CATEGORY') {
      if (!(await this.prisma.scoped.category.findFirst({ where: { id: rule.scopeId } }))) {
        errors['scopeId'] = ['the category does not exist'];
      }
    } else if (rule.scope === 'PRODUCT') {
      if (!(await this.prisma.scoped.product.findFirst({ where: { id: rule.scopeId } }))) {
        errors['scopeId'] = ['the product does not exist'];
      }
    }
    if (rule.salespersonId) {
      if (
        !(await this.prisma.scoped.userWorkspace.findFirst({
          where: { userId: rule.salespersonId },
        }))
      ) {
        errors['salespersonId'] = ['this person is not on your team'];
      }
    }
    if (Object.keys(errors).length > 0) throw new ValidationFailedException(errors);
    return {
      ...rule,
      scopeId: rule.scope === 'ALL' ? null : rule.scopeId,
    };
  }
}

const staffRuleWhere = (userId: string): Prisma.CommissionRuleWhereInput => ({
  salespersonId: userId,
  name: STAFF_RULE_NAME,
  calcType: 'PERCENTAGE',
  baseType: 'NET_SALES',
  scope: 'ALL',
});
