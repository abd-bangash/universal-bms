import { Injectable } from '@nestjs/common';
import { Prisma, type PosSession, type Receipt } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { DomainEventBus } from '../../common/events/domain-event-bus';
import { D } from '../../common/money';
import { keysetCursor, keysetWhere, toPage, type Page } from '../../common/pagination/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../crm/timeline.service';
import { orderLineDto, taxBreakdown } from '../documents/snapshot.builders';
import { InventoryService } from '../inventory/inventory.service';
import { NumberingService } from '../numbering/numbering.service';
import { PricingService } from '../pricing/pricing.service';
import { DocumentLinesService } from '../sales/document-lines.service';
import { OrderFactory } from '../sales/order-factory.service';
import { toOrderDto } from '../sales/order.support';
import { SettingsService } from '../settings/settings.service';
import { WorkflowService } from '../workflows/workflow.service';
import { recalculateOrder } from '../finance/order-balance';
import type { CheckoutDto, ListReceiptsQuery } from './dto/pos.dto';

export interface SessionDto {
  id: string;
  cashierId: string;
  locationId: string;
  status: string;
  openedAt: string;
  openingFloat: string;
}

export interface ReceiptDto {
  id: string;
  receiptNumber: string;
  orderId: string | null;
  orderNumber: string | null;
  customerName: string | null;
  type: string;
  issuedAt: string;
  totalAmount: string | null;
  reprintCount: number;
  data?: unknown;
}

const sessionDto = (s: PosSession): SessionDto => ({
  id: s.id,
  cashierId: s.cashierId,
  locationId: s.locationId,
  status: s.status,
  openedAt: s.openedAt.toISOString(),
  openingFloat: s.openingFloat.toFixed(),
});

const dayIn = (timeZone: string, at: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);

/** Counter sales: one transaction makes the order, the stock movements, the payment and the receipt (Requirement 12). */
@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricing: PricingService,
    private readonly lines: DocumentLinesService,
    private readonly orders: OrderFactory,
    private readonly inventory: InventoryService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly workflows: WorkflowService,
    private readonly timeline: TimelineService,
    private readonly events: DomainEventBus,
  ) {}

  // ── sessions ────────────────────────────────────────────────────────────────────────────

  /**
   * The cashier's open session. Release 1 opens it by itself on the first sale of the day, at the
   * cashier's default location; a session left open from an earlier day is closed first.
   * Explicit opening with a float, and closing with reconciliation, arrive in Release 3.
   */
  async currentSession(user: AuthUser): Promise<SessionDto> {
    return sessionDto(await this.ensureSession(user));
  }

  private async ensureSession(user: AuthUser): Promise<PosSession> {
    const timeZone = await this.settings.get<string>('locale.timezone');
    const open = await this.prisma.scoped.posSession.findFirst({
      where: { cashierId: user.userId, status: 'OPEN' },
    });
    const now = new Date();
    if (open && dayIn(timeZone, open.openedAt) === dayIn(timeZone, now)) return open;
    if (open) {
      await this.prisma.scoped.posSession.update({
        where: { id: open.id },
        data: {
          status: 'CLOSED',
          closedAt: now,
          closeNote: 'Closed automatically at the start of a new day',
        },
      });
    }
    const membership = await this.prisma.scoped.userWorkspace.findFirst({
      where: { userId: user.userId },
    });
    const locationId = await this.resolveLocation(membership?.defaultLocationId ?? null);
    try {
      return await this.prisma.scoped.$transaction(async (tx) => {
        const created = await tx.posSession.create({
          data: { workspaceId: user.workspaceId, cashierId: user.userId, locationId },
        });
        await this.audit.record(tx, {
          action: 'pos.session_open',
          entityType: 'PosSession',
          entityId: created.id,
          after: sessionDto(created) as unknown as Record<string, unknown>,
        });
        return created;
      });
    } catch (err) {
      // two first sales at once: the other request opened it
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.prisma.scoped.posSession.findFirst({
          where: { cashierId: user.userId, status: 'OPEN' },
        });
        if (again) return again;
      }
      throw err;
    }
  }

  private async resolveLocation(preferred: string | null): Promise<string> {
    const configured = await this.settings.get<string | undefined>('inventory.defaultLocationId');
    for (const id of [preferred, configured]) {
      if (!id) continue;
      const found = await this.prisma.scoped.inventoryLocation.findFirst({
        where: { id, active: true },
      });
      if (found) return found.id;
    }
    const fallback =
      (await this.prisma.scoped.inventoryLocation.findFirst({
        where: { isDefault: true, active: true },
      })) ??
      (await this.prisma.scoped.inventoryLocation.findFirst({
        where: { active: true },
        orderBy: { name: 'asc' },
      }));
    if (!fallback)
      throw new AppException('VALIDATION_FAILED', 422, 'Add an inventory location first');
    return fallback.id;
  }

  // ── checkout (design.md, POS) ───────────────────────────────────────────────────────────

  async checkout(user: AuthUser, dto: CheckoutDto) {
    const session = await this.ensureSession(user);

    // the customer: the selected one, or the workspace's walk-in customer (Requirement 12.10)
    const customer = dto.customerId
      ? await this.prisma.scoped.customer.findFirst({
          where: { id: dto.customerId, isWalkIn: false },
        })
      : await this.prisma.scoped.customer.findFirst({ where: { isWalkIn: true } });
    if (!customer) {
      throw new ValidationFailedException({ customerId: ['does not exist'] });
    }
    const salespersonId = dto.salespersonId ?? user.userId;
    await this.lines.assertAssignee(salespersonId);

    // the payment: one method in Release 1, enough to cover the total (Requirement 12.3)
    const method = await this.prisma.scoped.paymentMethod.findFirst({
      where: { id: dto.payment.paymentMethodId, active: true },
      include: { account: true },
    });
    if (!method || !method.account.active) {
      throw new ValidationFailedException({
        'payment.paymentMethodId': ['is not an available payment method'],
      });
    }
    if (method.requiresReference && !dto.payment.referenceNumber?.trim()) {
      throw new ValidationFailedException({
        'payment.referenceNumber': [`is required for ${method.name} payments`],
      });
    }
    const isCash = method.type === 'CASH';

    const priced = await this.pricing.price(user, {
      lines: dto.lines,
      orderDiscount: dto.orderDiscount ?? null,
      customerId: dto.customerId ?? null,
      cash: isCash,
    });
    const rows = await this.lines.rows('ORDER_ITEM', priced);
    const totals = this.lines.totals(priced);
    const total = D(totals.totalAmount);

    const tendered = isCash ? D(dto.payment.tendered ?? totals.totalAmount) : total;
    if (!isCash && dto.payment.tendered !== undefined && !D(dto.payment.tendered).eq(total)) {
      throw new ValidationFailedException({
        'payment.tendered': ['must equal the total for this payment method'],
      });
    }
    if (tendered.lt(total)) {
      throw new AppException('VALIDATION_FAILED', 422, 'The payment does not cover the total', {
        'payment.tendered': [`must be at least ${total.toFixed()}`],
      });
    }
    const changeDue = tendered.minus(total);

    const completed = (await this.workflows.get('ORDER')).states.find(
      (s) => s.systemRole === 'COMPLETED' && s.active,
    );
    if (!completed)
      throw new AppException('INTERNAL_ERROR', 500, 'The order workflow has no completed state');

    const result = await this.prisma.scoped.$transaction(async (tx) => {
      // 4. the order, created directly in the completed state; no reservation step
      const made = await this.orders.create(tx, user, {
        customerId: customer.id,
        orderType: 'POS',
        source: 'POS',
        locationId: session.locationId,
        assignedToId: salespersonId,
        notes: dto.note?.trim() || null,
        discount: dto.orderDiscount
          ? { type: dto.orderDiscount.type, value: dto.orderDiscount.value }
          : null,
        totals,
        lines: rows,
      });
      const now = new Date();
      await tx.order.update({
        where: { id: made.order.id },
        data: {
          status: completed.key,
          posSessionId: session.id,
          closedAt: now,
          deliveredAt: now,
          deliveredById: user.userId,
          fulfilmentMethod: 'PICKUP',
        },
      });
      await tx.statusHistory.create({
        data: {
          workspaceId: user.workspaceId,
          entityType: 'ORDER',
          entityId: made.order.id,
          fromKey: made.order.status,
          toKey: completed.key,
          changedById: user.userId,
          note: 'Counter sale',
        },
      });
      await this.lines.auditOverrides(tx, user, 'Order', made.order.id, priced);

      // 5. SALE movements for the stock-tracked lines, at the cost of the moment
      const variants = await tx.productVariant.findMany({
        where: {
          id: {
            in: made.items
              .filter((i) => i.stockTracked && i.variantId)
              .map((i) => i.variantId as string),
          },
        },
        include: { product: true },
      });
      const factor = new Map(variants.map((v) => [v.id, D(v.product.saleUnitFactor.toFixed())]));
      const stockLines = made.items
        .filter((i) => i.stockTracked && i.variantId)
        .map((i) => ({
          orderItemId: i.id,
          variantId: i.variantId as string,
          lineQuantity: D(i.quantity.toFixed()),
          baseQuantity: D(i.quantity.toFixed()).mul(factor.get(i.variantId as string) ?? 1),
        }));
      const posted = await this.inventory.sell(
        tx,
        user.workspaceId,
        made.order.id,
        session.locationId,
        stockLines,
        user.userId,
      );

      // 6. the payment, confirmed, linked to the session; the order is paid in full
      const payment = await tx.payment.create({
        data: {
          workspaceId: user.workspaceId,
          paymentNumber: await this.numbering.next(tx, 'PAYMENT'),
          type: 'ORDER_PAYMENT',
          status: 'CONFIRMED',
          orderId: made.order.id,
          customerId: customer.id,
          paymentMethodId: method.id,
          accountId: method.accountId,
          amount: total.toFixed(),
          referenceNumber: dto.payment.referenceNumber?.trim() || null,
          posSessionId: session.id,
          recordedById: user.userId,
          confirmedById: user.userId,
          confirmedAt: now,
        },
      });
      const { order } = await recalculateOrder(tx, made.order.id);

      // 7. the receipt with its full snapshot
      const [business, locale, footer, cashier, salesperson] = await Promise.all([
        this.settings.get<Record<string, string>>('business'),
        this.settings.get<{
          currency: string;
          currencyDecimals: number;
          language: string;
          dateFormat: string;
          timezone: string;
        }>('locale'),
        this.settings.get<string | undefined>('documents.receiptFooter'),
        tx.user.findFirst({
          where: { id: user.userId },
          select: { firstName: true, lastName: true },
        }),
        tx.user.findFirst({
          where: { id: salespersonId },
          select: { firstName: true, lastName: true },
        }),
      ]);
      const lineDtos = made.items.map(orderLineDto);
      const branding = await this.settings.get<{ logoFileId?: string }>('branding');
      const receipt = await tx.receipt.create({
        data: {
          workspaceId: user.workspaceId,
          receiptNumber: await this.numbering.next(tx, 'RECEIPT'),
          orderId: made.order.id,
          paymentId: payment.id,
          type: 'SALE',
          data: {
            business: { ...business, logoFileId: branding.logoFileId },
            currency: { code: locale.currency, decimals: locale.currencyDecimals },
            locale: {
              language: locale.language,
              dateFormat: locale.dateFormat,
              timezone: locale.timezone,
            },
            transactionNumber: order.orderNumber,
            issuedAt: now.toISOString(),
            cashier: cashier ? `${cashier.firstName} ${cashier.lastName}` : null,
            salesperson: salesperson ? `${salesperson.firstName} ${salesperson.lastName}` : null,
            customer: customer.isWalkIn ? null : { id: customer.id, name: customer.fullName },
            lines: lineDtos,
            totals: {
              subtotal: order.subtotal.toFixed(),
              discountAmount: order.discountAmount.toFixed(),
              taxAmount: order.taxAmount.toFixed(),
              roundingAmount: order.roundingAmount.toFixed(),
              totalAmount: order.totalAmount.toFixed(),
            },
            discount: { type: order.discountType, value: order.discountValue.toFixed() },
            taxBreakdown: taxBreakdown(lineDtos),
            payments: [
              {
                method: method.name,
                amount: total.toFixed(),
                reference: payment.referenceNumber,
              },
            ],
            tendered: tendered.toFixed(),
            changeDue: changeDue.toFixed(),
            footer: footer ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      // 8. audit
      await this.audit.record(tx, {
        action: 'pos.checkout',
        entityType: 'Order',
        entityId: order.id,
        after: {
          orderNumber: order.orderNumber,
          total: total.toFixed(),
          receiptNumber: receipt.receiptNumber,
          paymentNumber: payment.paymentNumber,
        },
        metadata: { sessionId: session.id, method: method.name },
      });
      return { order, items: made.items, payment, receipt, posted };
    });

    await this.timeline.record({
      customerId: customer.isWalkIn ? undefined : customer.id,
      orderId: result.order.id,
      type: 'ORDER',
      refType: 'Order',
      refId: result.order.id,
      summary: `Counter sale ${result.order.orderNumber} completed`,
      actorUserId: user.userId,
    });
    await this.inventory.announce(user.workspaceId, user.userId, result.posted);
    await this.events.publish('order.created', {
      workspaceId: user.workspaceId,
      orderId: result.order.id,
      actorUserId: user.userId,
    });
    await this.events.publish('payment.confirmed', {
      workspaceId: user.workspaceId,
      paymentId: result.payment.id,
      orderId: result.order.id,
      customerId: customer.id,
      actorUserId: user.userId,
    });
    return {
      order: toOrderDto(result.order, { items: result.items }),
      receipt: { id: result.receipt.id, receiptNumber: result.receipt.receiptNumber },
      tendered: tendered.toFixed(),
      changeDue: changeDue.toFixed(),
      session: sessionDto(session),
    };
  }

  // ── receipts (Requirement 12.14, 29.8) ──────────────────────────────────────────────────

  async receipts(query: ListReceiptsQuery): Promise<Page<ReceiptDto>> {
    const filters: Prisma.ReceiptWhereInput[] = [{ type: 'SALE' }];
    if (query.customerId) filters.push({ order: { customerId: query.customerId } });
    if (query.from) filters.push({ issuedAt: { gte: new Date(query.from) } });
    if (query.to) filters.push({ issuedAt: { lte: new Date(query.to) } });
    if (query.q?.trim()) {
      const text = { contains: query.q.trim(), mode: 'insensitive' as const };
      filters.push({
        OR: [
          { receiptNumber: text },
          { order: { orderNumber: text } },
          { order: { customer: { fullName: text } } },
        ],
      });
    }
    const after = keysetWhere('issuedAt', 'desc', query.cursor, true);
    if (after) filters.push(after as Prisma.ReceiptWhereInput);
    const rows = await this.prisma.scoped.receipt.findMany({
      where: { AND: filters },
      include: { order: { include: { customer: true } } },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) => keysetCursor(last.issuedAt, last.id)).map((r) =>
      this.receiptDto(r, r.order ?? null),
    );
  }

  async receipt(id: string): Promise<ReceiptDto> {
    const row = await this.prisma.scoped.receipt.findFirst({
      where: { id },
      include: { order: { include: { customer: true } } },
    });
    if (!row) throw new NotFoundAppException();
    return { ...this.receiptDto(row, row.order ?? null), data: row.data };
  }

  /** Counts a reprint and records it; the copy is marked as a reprint when it is drawn (Requirement 29.8). */
  async reprint(user: AuthUser, id: string): Promise<ReceiptDto> {
    const existing = await this.prisma.scoped.receipt.findFirst({ where: { id } });
    if (!existing) throw new NotFoundAppException();
    await this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.receipt.update({
        where: { id },
        data: { reprintCount: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'receipt.reprint',
        entityType: 'Receipt',
        entityId: id,
        before: { reprintCount: existing.reprintCount },
        after: { reprintCount: row.reprintCount },
        metadata: { receiptNumber: row.receiptNumber, userId: user.userId },
      });
    });
    return this.receipt(id);
  }

  private receiptDto(
    r: Receipt,
    order: {
      orderNumber: string;
      totalAmount: Prisma.Decimal;
      customer: { fullName: string; isWalkIn: boolean };
    } | null,
  ): ReceiptDto {
    return {
      id: r.id,
      receiptNumber: r.receiptNumber,
      orderId: r.orderId,
      orderNumber: order?.orderNumber ?? null,
      customerName: order && !order.customer.isWalkIn ? order.customer.fullName : null,
      type: r.type,
      issuedAt: r.issuedAt.toISOString(),
      totalAmount: order ? order.totalAmount.toFixed() : null,
      reprintCount: r.reprintCount,
    };
  }
}
