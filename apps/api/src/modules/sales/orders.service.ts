import { Injectable } from '@nestjs/common';
import type { Customer, Lead, Order, OrderItem, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { DomainEventBus } from '../../common/events/domain-event-bus';
import {
  keysetCursor,
  keysetWhere,
  parseSort,
  toPage,
  type Page,
} from '../../common/pagination/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineQuery } from '../crm/dto/customers.dto';
import { LeadsService } from '../crm/leads.service';
import { TimelineService } from '../crm/timeline.service';
import { FieldsService } from '../fields/fields.service';
import { FilesService } from '../files/files.service';
import { PricingService } from '../pricing/pricing.service';
import { WorkflowService } from '../workflows/workflow.service';
import { DocumentLinesService } from './document-lines.service';
import type {
  ChangeOrderStatusDto,
  CreateOrderDto,
  FulfilmentDto,
  ListOrdersQuery,
  UpdateOrderDto,
} from './dto/orders.dto';
import { json } from './line-rows';
import { OrderFactory } from './order-factory.service';
import { toOrderDto, type OrderDto } from './order.support';

const SORTS = ['orderDate', 'createdAt'] as const;
const refuse = (message: string) => new AppException('VALIDATION_FAILED', 422, message);
const audited = (o: OrderDto): Record<string, unknown> => o as unknown as Record<string, unknown>;
const closed = (status: string) => status === 'completed' || status === 'cancelled';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricing: PricingService,
    private readonly lines: DocumentLinesService,
    private readonly factory: OrderFactory,
    private readonly workflows: WorkflowService,
    private readonly timeline: TimelineService,
    private readonly events: DomainEventBus,
    private readonly files: FilesService,
    private readonly fields: FieldsService,
    private readonly leads: LeadsService,
  ) {}

  // ── visibility ──────────────────────────────────────────────────────────────────────────

  /** Without `order:view_all` a person sees only the orders assigned to or created by them (Requirement 54.2). */
  private scope(user: AuthUser): Prisma.OrderWhereInput {
    return user.permissions.includes('order:view_all')
      ? {}
      : { OR: [{ assignedToId: user.userId }, { createdById: user.userId }] };
  }

  private canViewCost = (user: AuthUser) => user.permissions.includes('product:view_cost');

  /** The order as this user may see it; 404 otherwise. */
  async row(user: AuthUser, id: string): Promise<Order> {
    const order = await this.prisma.scoped.order.findFirst({
      where: { AND: [{ id }, this.scope(user)] },
    });
    if (!order) throw new NotFoundAppException();
    return order;
  }

  private async full(
    user: AuthUser,
    id: string,
  ): Promise<OrderDto & { allowedTransitions: unknown[] }> {
    const order = await this.prisma.scoped.order.findFirst({
      where: { AND: [{ id }, this.scope(user)] },
      include: { items: { orderBy: { lineNo: 'asc' } }, salespeople: true },
    });
    if (!order) throw new NotFoundAppException();
    const { items, salespeople, ...rest } = order;
    const workflow = await this.workflows.get('ORDER');
    return {
      ...toOrderDto(rest as Order, { items, salespeople, canViewCost: this.canViewCost(user) }),
      allowedTransitions: this.workflows.allowedTransitions(workflow, order.status),
    };
  }

  // ── reads ───────────────────────────────────────────────────────────────────────────────

  async list(user: AuthUser, query: ListOrdersQuery): Promise<Page<OrderDto>> {
    const sort = parseSort(query.sort, SORTS, { field: 'orderDate', direction: 'desc' });
    const filters: Prisma.OrderWhereInput[] = [this.scope(user)];
    if (query.status) filters.push({ status: query.status });
    if (query.paymentStatus)
      filters.push({ paymentStatus: query.paymentStatus as Order['paymentStatus'] });
    if (query.customerId) filters.push({ customerId: query.customerId });
    if (query.assignedToId) filters.push({ assignedToId: query.assignedToId });
    if (query.orderType) filters.push({ orderType: query.orderType });
    if (query.from) filters.push({ orderDate: { gte: new Date(query.from) } });
    if (query.to) filters.push({ orderDate: { lte: new Date(query.to) } });
    if (query.q?.trim()) {
      const text = { contains: query.q.trim(), mode: 'insensitive' as const };
      filters.push({ OR: [{ orderNumber: text }, { customer: { fullName: text } }] });
    }
    const after = keysetWhere(sort.field, sort.direction, query.cursor, true);
    if (after) filters.push(after as Prisma.OrderWhereInput);
    const rows = await this.prisma.scoped.order.findMany({
      where: { AND: filters },
      orderBy: [{ [sort.field]: sort.direction }, { id: sort.direction }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) =>
      keysetCursor(sort.field === 'createdAt' ? last.createdAt : last.orderDate, last.id),
    ).map((o) => toOrderDto(o));
  }

  get(user: AuthUser, id: string) {
    return this.full(user, id);
  }

  async attachments(user: AuthUser, id: string) {
    await this.row(user, id);
    return this.files.listForEntity('ORDER', id);
  }

  async timelineOf(user: AuthUser, id: string, query: TimelineQuery) {
    await this.row(user, id);
    return this.timeline.listFor({ orderId: id }, query);
  }

  async history(user: AuthUser, id: string) {
    await this.row(user, id);
    const rows = await this.prisma.scoped.statusHistory.findMany({
      where: { entityType: 'ORDER', entityId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      from: r.fromKey,
      to: r.toKey,
      changedById: r.changedById,
      actorType: r.actorType,
      note: r.note,
      changedAt: r.createdAt.toISOString(),
    }));
  }

  // ── create and edit ─────────────────────────────────────────────────────────────────────

  async create(user: AuthUser, dto: CreateOrderDto): Promise<OrderDto> {
    const customer = await this.prisma.scoped.customer.findFirst({
      where: { id: dto.customerId, isWalkIn: false },
    });
    if (!customer) throw new ValidationFailedException({ customerId: ['does not exist'] });
    const lead = dto.leadId ? await this.leads.row(user, dto.leadId).catch(() => null) : null;
    if (dto.leadId && !lead) throw new ValidationFailedException({ leadId: ['does not exist'] });
    await this.lines.assertAssignee(dto.assignedToId);
    await this.assertLocation(dto.locationId);

    const pricing = await this.pricing.price(user, {
      lines: dto.lines ?? [],
      orderDiscount: dto.orderDiscount ?? null,
      customerId: customer.id,
    });
    const rows = await this.lines.rows('ORDER_ITEM', pricing);
    const totals = this.lines.totals(pricing);
    const customFields = await this.fields.validate('ORDER', dto.customFields ?? {}, {});
    const fulfilment = this.fulfilmentData(dto);

    const created = await this.prisma.scoped.$transaction(async (tx) => {
      const made = await this.factory.create(tx, user, {
        customerId: customer.id,
        leadId: lead?.id ?? null,
        orderType: dto.orderType ?? (rows.some((r) => r.kind === 'CUSTOM') ? 'CUSTOM' : 'STANDARD'),
        source: dto.source ?? 'MANUAL',
        channel: dto.channel ?? lead?.channel ?? null,
        campaign: dto.campaign ?? lead?.campaign ?? null,
        locationId: dto.locationId ?? null,
        assignedToId: dto.assignedToId === undefined ? user.userId : dto.assignedToId,
        notes: dto.notes?.trim() || null,
        internalNotes: dto.internalNotes?.trim() || null,
        customFields,
        discount: dto.orderDiscount
          ? { type: dto.orderDiscount.type, value: dto.orderDiscount.value }
          : null,
        totals,
        lines: rows,
      });
      await this.lines.auditOverrides(tx, user, 'Order', made.order.id, pricing);
      if (Object.keys(fulfilment).length > 0) {
        await tx.order.update({ where: { id: made.order.id }, data: fulfilment });
      }
      return made;
    });

    await this.timeline.record({
      customerId: customer.id,
      leadId: lead?.id,
      orderId: created.order.id,
      type: 'ORDER',
      refType: 'Order',
      refId: created.order.id,
      summary: `Order ${created.order.orderNumber} created`,
      actorUserId: user.userId,
    });
    await this.events.publish('order.created', {
      workspaceId: user.workspaceId,
      orderId: created.order.id,
      actorUserId: user.userId,
    });
    return this.full(user, created.order.id);
  }

  /** Called by lead conversion: a draft order pre-filled from the lead's interest (Requirement 9.4). */
  async createFromLead(
    user: AuthUser,
    lead: Lead,
    customer: Customer,
  ): Promise<{ id: string; number: string }> {
    const line = await this.lines.lineFromLead('ORDER_ITEM', lead);
    const order = await this.create(user, {
      customerId: customer.id,
      leadId: lead.id,
      lines: [line],
      notes: lead.requirements ?? undefined,
      source: 'MANUAL',
      channel: lead.channel,
      campaign: lead.campaign,
      assignedToId: lead.assignedToId ?? user.userId,
    });
    await this.files.copyAttachments(
      { entityType: 'LEAD', entityId: lead.id },
      { entityType: 'ORDER', entityId: order.id },
    );
    return { id: order.id, number: order.orderNumber };
  }

  async update(user: AuthUser, id: string, dto: UpdateOrderDto): Promise<OrderDto> {
    const existing = await this.row(user, id);
    if (closed(existing.status)) throw refuse(`A ${existing.status} order cannot be edited`);
    const draft = (await this.stateRole(existing.status)) === 'DRAFT';
    if ((dto.lines !== undefined || dto.orderDiscount !== undefined) && !draft) {
      throw refuse('Lines and discounts can only be changed while the order is a draft');
    }
    if (dto.orderDiscount !== undefined && dto.lines === undefined) {
      throw new ValidationFailedException({
        orderDiscount: ['send the lines together with the discount'],
      });
    }
    if (dto.customerId !== undefined && !draft) {
      throw refuse('The customer can only be changed while the order is a draft');
    }
    if (dto.customerId !== undefined) {
      const customer = await this.prisma.scoped.customer.findFirst({
        where: { id: dto.customerId, isWalkIn: false },
      });
      if (!customer) throw new ValidationFailedException({ customerId: ['does not exist'] });
    }
    await this.lines.assertAssignee(dto.assignedToId);
    await this.assertLocation(dto.locationId);

    const customerId = dto.customerId ?? existing.customerId;
    const pricing =
      dto.lines !== undefined
        ? await this.pricing.price(user, {
            lines: dto.lines,
            orderDiscount: dto.orderDiscount ?? null,
            customerId,
          })
        : null;
    const rows = pricing ? await this.lines.rows('ORDER_ITEM', pricing) : null;
    const totals = pricing ? this.lines.totals(pricing) : null;
    const customFields =
      dto.customFields === undefined
        ? undefined
        : await this.fields.validate('ORDER', dto.customFields, {
            existing: existing.customFields as Record<string, unknown>,
          });
    const fulfilment = this.fulfilmentData(dto);
    const before = toOrderDto(existing);

    await this.prisma.scoped.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id, version: dto.version },
        data: {
          customerId,
          orderType: dto.orderType,
          source: dto.source,
          channel: dto.channel,
          campaign: dto.campaign,
          locationId: dto.locationId,
          assignedToId: dto.assignedToId,
          notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
          internalNotes:
            dto.internalNotes === undefined ? undefined : dto.internalNotes?.trim() || null,
          customFields: customFields ? json(customFields) : undefined,
          ...fulfilment,
          ...(totals
            ? {
                subtotal: totals.subtotal,
                discountType: dto.orderDiscount?.type ?? null,
                discountValue: dto.orderDiscount?.value ?? '0',
                discountAmount: totals.discountAmount,
                taxAmount: totals.taxAmount,
                roundingAmount: totals.roundingAmount,
                totalAmount: totals.totalAmount,
                // nothing has been paid on a draft that can still change its lines
                balanceDue: totals.totalAmount,
              }
            : {}),
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        throw new AppException(
          'STALE_VERSION',
          409,
          'This order was changed by someone else; reload and try again',
        );
      }
      if (rows) {
        await tx.orderItem.deleteMany({ where: { orderId: id } });
        for (const row of rows) {
          await tx.orderItem.create({
            data: {
              workspaceId: user.workspaceId,
              orderId: id,
              lineNo: row.lineNo,
              kind: row.kind,
              productId: row.productId,
              variantId: row.variantId,
              name: row.name,
              sku: row.sku,
              description: row.description,
              quantity: row.quantity,
              unitId: row.unitId,
              listPrice: row.listPrice,
              unitPrice: row.unitPrice,
              discountType: row.discountType,
              discountValue: row.discountValue,
              discountAmount: row.discountAmount,
              taxClassId: row.taxClassId,
              taxRate: row.taxRate,
              taxAmount: row.taxAmount,
              lineTotal: row.lineTotal,
              stockTracked: row.stockTracked,
              notes: row.notes,
              customFields: json(row.customFields),
              fieldSnapshot: json(row.fieldSnapshot),
            },
          });
        }
        if (pricing) await this.lines.auditOverrides(tx, user, 'Order', id, pricing);
      }
      if (dto.assignedToId !== undefined) {
        await tx.orderSalesperson.deleteMany({ where: { orderId: id } });
        if (dto.assignedToId) {
          await tx.orderSalesperson.create({
            data: {
              workspaceId: user.workspaceId,
              orderId: id,
              userId: dto.assignedToId,
              sharePercent: '100',
            },
          });
        }
      }
      const after = await tx.order.findFirstOrThrow({ where: { id } });
      await this.audit.record(tx, {
        action: 'order.update',
        entityType: 'Order',
        entityId: id,
        before: audited(before),
        after: audited(toOrderDto(after)),
      });
    });
    return this.full(user, id);
  }

  // ── status (Requirement 11.2, 39.5, 39.10) ──────────────────────────────────────────────

  async changeStatus(user: AuthUser, id: string, dto: ChangeOrderStatusDto) {
    const before = await this.row(user, id);
    const result = await this.workflows.transition('ORDER', id, dto.status, {
      note: dto.note,
      data: { reason: dto.reason, paymentDecision: dto.paymentDecision },
      actor: { userId: user.userId, permissions: user.permissions },
    });
    if (!result.pendingApproval) {
      await this.timeline.record({
        customerId: before.customerId,
        leadId: before.leadId ?? undefined,
        orderId: id,
        type: 'STATUS',
        refType: 'Order',
        refId: id,
        summary: `Order ${before.orderNumber} moved from ${result.from} to ${result.to}`,
        actorUserId: user.userId,
      });
      await this.winLinkedLead(user, id, result.to);
    }
    return {
      order: await this.full(user, id),
      pendingApproval: result.pendingApproval,
      ...(result.pendingApproval ? { approvalRequestId: result.approvalRequestId } : {}),
    };
  }

  /** Confirming an order closes the enquiry it came from as won (tasks.md 35). */
  private async winLinkedLead(user: AuthUser, orderId: string, toKey: string): Promise<void> {
    const order = await this.prisma.scoped.order.findFirstOrThrow({ where: { id: orderId } });
    if (!order.leadId) return;
    const [orderFlow, leadFlow] = await Promise.all([
      this.workflows.get('ORDER'),
      this.workflows.get('LEAD'),
    ]);
    if (orderFlow.states.find((s) => s.key === toKey)?.systemRole !== 'CONFIRMED') return;
    const won = leadFlow.states.find((s) => s.systemRole === 'WON' && s.active);
    const lead = await this.prisma.scoped.lead.findFirst({ where: { id: order.leadId } });
    if (!won || !lead || lead.stage === won.key) return;
    const current = leadFlow.states.find((s) => s.key === lead.stage);
    if (current?.category === 'DONE' || current?.category === 'CANCELLED') return; // already closed
    await this.workflows
      .transition('LEAD', lead.id, won.key, {
        note: `Order ${order.orderNumber} confirmed`,
        actor: { userId: user.userId, permissions: user.permissions, actorType: 'SYSTEM' },
      })
      .catch(() => undefined); // a lead that cannot move straight to Won is left where it is
  }

  // ── fulfilment (Requirement 39.9) ───────────────────────────────────────────────────────

  async fulfilment(user: AuthUser, id: string, dto: FulfilmentDto): Promise<OrderDto> {
    const existing = await this.row(user, id);
    if (existing.status === 'cancelled') throw refuse('A cancelled order cannot be changed');
    const data = this.fulfilmentData(dto);
    if (dto.proofFileId) {
      await this.files.attach(dto.proofFileId, {
        entityType: 'ORDER',
        entityId: id,
        purpose: 'proof',
      });
    }
    if (dto.deliveredById) await this.lines.assertAssignee(dto.deliveredById);
    const before = toOrderDto(existing);
    await this.prisma.scoped.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      const after = await tx.order.findFirstOrThrow({ where: { id } });
      await this.audit.record(tx, {
        action: 'order.fulfilment',
        entityType: 'Order',
        entityId: id,
        before: audited(before),
        after: audited(toOrderDto(after)),
      });
    });
    return this.full(user, id);
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────

  private fulfilmentData(dto: FulfilmentDto): Prisma.OrderUncheckedUpdateInput {
    const data: Prisma.OrderUncheckedUpdateInput = {};
    if (dto.method !== undefined) data.fulfilmentMethod = dto.method;
    if (dto.deliveryAddress !== undefined)
      data.deliveryAddress = dto.deliveryAddress ? json(dto.deliveryAddress) : undefined;
    if (dto.scheduledAt !== undefined)
      data.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    if (dto.deliveredAt !== undefined)
      data.deliveredAt = dto.deliveredAt ? new Date(dto.deliveredAt) : null;
    if (dto.deliveredById !== undefined) data.deliveredById = dto.deliveredById;
    if (dto.receiverName !== undefined) data.receiverName = dto.receiverName?.trim() || null;
    if (dto.proofFileId !== undefined) data.proofFileId = dto.proofFileId;
    return data;
  }

  private async assertLocation(locationId: string | undefined): Promise<void> {
    if (!locationId) return;
    const location = await this.prisma.scoped.inventoryLocation.findFirst({
      where: { id: locationId, active: true },
    });
    if (!location) throw new ValidationFailedException({ locationId: ['does not exist'] });
  }

  private async stateRole(statusKey: string): Promise<string | null> {
    const workflow = await this.workflows.get('ORDER');
    return workflow.states.find((s) => s.key === statusKey)?.systemRole ?? null;
  }
}

export type { OrderItem };
