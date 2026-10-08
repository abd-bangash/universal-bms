import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import { Prisma, type Order, type Payment } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { DomainEventBus } from '../../common/events/domain-event-bus';
import { D } from '../../common/money';
import {
  keysetCursor,
  keysetWhere,
  parseSort,
  toPage,
  type Page,
} from '../../common/pagination/pagination';
import { PrismaService, type ScopedTransaction } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../crm/timeline.service';
import { FilesService } from '../files/files.service';
import { NumberingService } from '../numbering/numbering.service';
import { SettingsService } from '../settings/settings.service';
import { OrdersService } from '../sales/orders.service';
import { WorkflowService } from '../workflows/workflow.service';
import type {
  ApplyCreditDto,
  ListPaymentsQuery,
  ReceivablesQuery,
  RecordPaymentDto,
} from './dto/payments.dto';
import { customerCredit, lockCustomer, lockOrder, recalculateOrder } from './order-balance';
import {
  toCreditDto,
  toPaymentDto,
  toReceiptDto,
  type CreditEntryDto,
  type PaymentDto,
  type ReceiptDto,
} from './payment.support';

export interface ReceivablesSummary {
  customers: Array<{
    customerId: string;
    customerName: string;
    orders: number;
    invoiced: string;
    paid: string;
    outstanding: string;
    ageing: { current: string; days31to60: string; days61to90: string; over90: string };
  }>;
  totals: { invoiced: string; paid: string; outstanding: string };
}

const SORTS = ['paidAt', 'createdAt'] as const;
const refuse = (message: string, details?: Record<string, string[]>) =>
  new AppException('VALIDATION_FAILED', 422, message, details);
const audited = (p: PaymentDto): Record<string, unknown> => p as unknown as Record<string, unknown>;

/** The workflow key of the state an order enters when its required deposit is paid (default workflow). */
const DEPOSIT_PAID_KEY = 'deposit_paid';

/**
 * Payments, customer credit and the order balance (Requirements 11.5, 13, 40). Only CONFIRMED
 * payments change a balance; a customer message or an AI output can at most create a payment that
 * waits for a person to confirm it (Requirement 40.6).
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
    private readonly files: FilesService,
    private readonly timeline: TimelineService,
    private readonly events: DomainEventBus,
    private readonly workflows: WorkflowService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────────────────────────

  async list(query: ListPaymentsQuery): Promise<Page<PaymentDto>> {
    const sort = parseSort(query.sort, SORTS, { field: 'paidAt', direction: 'desc' });
    const filters: Prisma.PaymentWhereInput[] = [];
    if (query.status) filters.push({ status: query.status as Payment['status'] });
    if (query.type) filters.push({ type: query.type as Payment['type'] });
    if (query.orderId) filters.push({ orderId: query.orderId });
    if (query.customerId) filters.push({ customerId: query.customerId });
    if (query.paymentMethodId) filters.push({ paymentMethodId: query.paymentMethodId });
    if (query.from) filters.push({ paidAt: { gte: new Date(query.from) } });
    if (query.to) filters.push({ paidAt: { lte: new Date(query.to) } });
    if (query.q?.trim()) {
      const text = { contains: query.q.trim(), mode: 'insensitive' as const };
      filters.push({
        OR: [{ paymentNumber: text }, { referenceNumber: text }, { customer: { fullName: text } }],
      });
    }
    const after = keysetWhere(sort.field, sort.direction, query.cursor, true);
    if (after) filters.push(after as Prisma.PaymentWhereInput);
    const rows = await this.prisma.scoped.payment.findMany({
      where: { AND: filters },
      orderBy: [{ [sort.field]: sort.direction }, { id: sort.direction }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) =>
      keysetCursor(sort.field === 'createdAt' ? last.createdAt : last.paidAt, last.id),
    ).map(toPaymentDto);
  }

  async get(id: string): Promise<PaymentDto> {
    return toPaymentDto(await this.load(id));
  }

  async receiptOf(id: string): Promise<ReceiptDto> {
    await this.load(id);
    const receipt = await this.prisma.scoped.receipt.findFirst({
      where: { paymentId: id },
      orderBy: { issuedAt: 'asc' },
    });
    if (!receipt) throw new NotFoundAppException('This payment has no receipt yet');
    return toReceiptDto(receipt);
  }

  async creditOf(customerId: string): Promise<{ balance: string; entries: CreditEntryDto[] }> {
    if (!(await this.prisma.scoped.customer.findFirst({ where: { id: customerId } }))) {
      throw new NotFoundAppException();
    }
    const entries = await this.prisma.scoped.customerCredit.findMany({
      where: { customerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return {
      balance: await customerCredit(this.prisma.scoped as unknown as ScopedTransaction, customerId),
      entries: entries.map(toCreditDto),
    };
  }

  // ── receivables (Requirement 13.4) ──────────────────────────────────────────────────────

  /**
   * Per customer: what has been invoiced (the net total of their confirmed, not cancelled orders),
   * what has been paid (net of refunds) and what is outstanding, with the outstanding balances
   * aged by order date.
   */
  async receivables(query: ReceivablesQuery): Promise<ReceivablesSummary> {
    const workspaceId = this.requireWorkspace();
    const workflow = await this.workflows.get('ORDER');
    const excluded = workflow.states
      .filter((s) => s.systemRole === 'DRAFT' || s.systemRole === 'CANCELLED')
      .map((s) => s.key);
    const rows = await this.prisma.scoped.$queryRaw<
      Array<{
        customer_id: string;
        full_name: string;
        orders: bigint;
        invoiced: Prisma.Decimal;
        paid: Prisma.Decimal;
        outstanding: Prisma.Decimal;
        current: Prisma.Decimal;
        d30: Prisma.Decimal;
        d60: Prisma.Decimal;
        d90: Prisma.Decimal;
      }>
    >`
      SELECT o.customer_id, c.full_name,
             COUNT(*) AS orders,
             SUM(o.total_amount - o.returned_amount) AS invoiced,
             SUM(o.paid_amount - o.refunded_amount) AS paid,
             SUM(GREATEST(o.balance_due, 0)) AS outstanding,
             SUM(CASE WHEN now() - o.order_date <= interval '30 days' THEN GREATEST(o.balance_due, 0) ELSE 0 END) AS current,
             SUM(CASE WHEN now() - o.order_date > interval '30 days' AND now() - o.order_date <= interval '60 days' THEN GREATEST(o.balance_due, 0) ELSE 0 END) AS d30,
             SUM(CASE WHEN now() - o.order_date > interval '60 days' AND now() - o.order_date <= interval '90 days' THEN GREATEST(o.balance_due, 0) ELSE 0 END) AS d60,
             SUM(CASE WHEN now() - o.order_date > interval '90 days' THEN GREATEST(o.balance_due, 0) ELSE 0 END) AS d90
      FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE o.workspace_id = ${workspaceId}
        ${excluded.length > 0 ? Prisma.sql`AND o.status NOT IN (${Prisma.join(excluded)})` : Prisma.empty}
        ${query.customerId ? Prisma.sql`AND o.customer_id = ${query.customerId}` : Prisma.empty}
      GROUP BY o.customer_id, c.full_name
      ${query.includeSettled === true ? Prisma.empty : Prisma.sql`HAVING SUM(GREATEST(o.balance_due, 0)) > 0`}
      ORDER BY outstanding DESC, c.full_name
      LIMIT ${query.limit ?? 50}`;
    const customers = rows.map((r) => ({
      customerId: r.customer_id,
      customerName: r.full_name,
      orders: Number(r.orders),
      invoiced: r.invoiced.toFixed(),
      paid: r.paid.toFixed(),
      outstanding: r.outstanding.toFixed(),
      ageing: {
        current: r.current.toFixed(),
        days31to60: r.d30.toFixed(),
        days61to90: r.d60.toFixed(),
        over90: r.d90.toFixed(),
      },
    }));
    const sum = (pick: (c: (typeof customers)[number]) => string) =>
      customers.reduce((a, c) => a.plus(pick(c)), D(0)).toFixed();
    return {
      customers,
      totals: {
        invoiced: sum((c) => c.invoiced),
        paid: sum((c) => c.paid),
        outstanding: sum((c) => c.outstanding),
      },
    };
  }

  private requireWorkspace(): string {
    const id = this.cls.get('workspaceId');
    if (!id) throw new Error('No workspace in context');
    return id;
  }

  // ── recording ───────────────────────────────────────────────────────────────────────────

  /**
   * Staff-entered payments are CONFIRMED when the person may confirm, otherwise they wait in
   * PENDING_VERIFICATION until someone who may does so (Requirement 40.5, 40.6).
   */
  async record(user: AuthUser, dto: RecordPaymentDto): Promise<PaymentDto> {
    const amount = D(dto.amount);
    if (!amount.gt(0)) throw new ValidationFailedException({ amount: ['must be more than zero'] });

    const method = await this.prisma.scoped.paymentMethod.findFirst({
      where: { id: dto.paymentMethodId, active: true },
      include: { account: true },
    });
    if (!method || !method.account.active) {
      throw new ValidationFailedException({
        paymentMethodId: ['is not an available payment method'],
      });
    }
    if (method.requiresReference && !dto.referenceNumber?.trim()) {
      throw new ValidationFailedException({
        referenceNumber: [`is required for ${method.name} payments`],
      });
    }

    let order: Order | null = null;
    let customerId: string | null = dto.customerId ?? null;
    if (dto.type === 'ADVANCE') {
      if (dto.orderId)
        throw new ValidationFailedException({ orderId: ['an advance is not for an order yet'] });
      if (!customerId) throw new ValidationFailedException({ customerId: ['is required'] });
      await this.assertCustomer(customerId);
    } else {
      if (!dto.orderId) throw new ValidationFailedException({ orderId: ['is required'] });
      order = await this.orders.row(user, dto.orderId);
      await this.assertPayable(order);
      customerId = order.customerId;
    }

    if (dto.proofFileId) await this.assertFileUsable(dto.proofFileId);
    const confirmed = user.permissions.includes('payment:confirm');

    const payment = await this.prisma.scoped.$transaction(async (tx) => {
      if (order) await lockOrder(tx, order.id);
      if (customerId) await lockCustomer(tx, customerId);
      if (order)
        await this.assertPayable(await tx.order.findFirstOrThrow({ where: { id: order.id } }));
      const number = await this.numbering.next(tx, 'PAYMENT');
      const row = await tx.payment.create({
        data: {
          workspaceId: user.workspaceId,
          paymentNumber: number,
          type: dto.type,
          status: confirmed ? 'CONFIRMED' : 'PENDING_VERIFICATION',
          orderId: order?.id ?? null,
          customerId,
          paymentMethodId: method.id,
          accountId: method.accountId,
          amount: amount.toFixed(),
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          referenceNumber: dto.referenceNumber?.trim() || null,
          proofFileId: dto.proofFileId ?? null,
          note: dto.note?.trim() || null,
          recordedById: user.userId,
          confirmedById: confirmed ? user.userId : null,
          confirmedAt: confirmed ? new Date() : null,
        },
      });
      if (confirmed) await this.onConfirmed(tx, user, row);
      await this.audit.record(tx, {
        action: 'payment.record',
        entityType: 'Payment',
        entityId: row.id,
        after: audited(toPaymentDto(row)),
      });
      return row;
    });
    if (dto.proofFileId) await this.attachProof(payment);
    await this.afterChange(
      user,
      payment,
      confirmed ? 'recorded and confirmed' : 'recorded, waiting for confirmation',
    );
    if (confirmed) await this.publishConfirmed(user, payment);
    return toPaymentDto(payment);
  }

  async confirm(user: AuthUser, id: string): Promise<PaymentDto> {
    const existing = await this.load(id);
    if (existing.status !== 'PENDING_VERIFICATION') {
      throw refuse(
        `Only a payment waiting for confirmation can be confirmed (this one is ${existing.status.toLowerCase()})`,
      );
    }
    const payment = await this.prisma.scoped.$transaction(async (tx) => {
      if (existing.orderId) await lockOrder(tx, existing.orderId);
      if (existing.customerId) await lockCustomer(tx, existing.customerId);
      const current = await tx.payment.findFirstOrThrow({ where: { id } });
      if (current.status !== 'PENDING_VERIFICATION')
        throw refuse('This payment was already decided');
      const row = await tx.payment.update({
        where: { id },
        data: { status: 'CONFIRMED', confirmedById: user.userId, confirmedAt: new Date() },
      });
      await this.onConfirmed(tx, user, row);
      await this.audit.record(tx, {
        action: 'payment.confirm',
        entityType: 'Payment',
        entityId: id,
        before: audited(toPaymentDto(current)),
        after: audited(toPaymentDto(row)),
      });
      return row;
    });
    await this.afterChange(user, payment, 'confirmed');
    await this.publishConfirmed(user, payment);
    return toPaymentDto(payment);
  }

  async reject(user: AuthUser, id: string, reason: string): Promise<PaymentDto> {
    const existing = await this.load(id);
    if (existing.status !== 'PENDING_VERIFICATION') {
      throw refuse(
        `Only a payment waiting for confirmation can be rejected (this one is ${existing.status.toLowerCase()})`,
      );
    }
    const payment = await this.prisma.scoped.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id, status: 'PENDING_VERIFICATION' },
        data: { status: 'REJECTED', rejectedReason: reason.trim() },
      });
      if (claimed.count === 0) throw refuse('This payment was already decided');
      const row = await tx.payment.findFirstOrThrow({ where: { id } });
      await this.audit.record(tx, {
        action: 'payment.reject',
        entityType: 'Payment',
        entityId: id,
        before: audited(toPaymentDto(existing)),
        after: audited(toPaymentDto(row)),
      });
      return row;
    });
    await this.afterChange(user, payment, `rejected: ${reason.trim()}`);
    return toPaymentDto(payment);
  }

  /** A confirmed payment is never edited; a mistake is voided with a reason and entered again (Requirement 40.7). */
  async void(user: AuthUser, id: string, reason: string): Promise<PaymentDto> {
    const existing = await this.load(id);
    if (existing.status !== 'CONFIRMED') {
      throw refuse(
        `Only a confirmed payment can be voided (this one is ${existing.status.toLowerCase()})`,
      );
    }
    const payment = await this.prisma.scoped.$transaction(async (tx) => {
      if (existing.orderId) await lockOrder(tx, existing.orderId);
      if (existing.customerId) await lockCustomer(tx, existing.customerId);
      const current = await tx.payment.findFirstOrThrow({ where: { id } });
      if (current.status !== 'CONFIRMED') throw refuse('This payment was already voided');
      await this.reverseCredit(tx, user, current);
      const row = await tx.payment.update({
        where: { id },
        data: {
          status: 'VOIDED',
          voidedById: user.userId,
          voidedAt: new Date(),
          voidReason: reason.trim(),
        },
      });
      if (row.orderId) await recalculateOrder(tx, row.orderId);
      await this.audit.record(tx, {
        action: 'payment.void',
        entityType: 'Payment',
        entityId: id,
        before: audited(toPaymentDto(current)),
        after: audited(toPaymentDto(row)),
      });
      return row;
    });
    await this.afterChange(user, payment, `voided: ${reason.trim()}`);
    await this.events.publish('payment.voided', {
      workspaceId: user.workspaceId,
      paymentId: payment.id,
      orderId: payment.orderId,
      customerId: payment.customerId,
      actorUserId: user.userId,
    });
    return toPaymentDto(payment);
  }

  // ── customer credit (Requirement 40.8) ──────────────────────────────────────────────────

  /** Spends part of a customer's credit on an order. Moves no money, so it needs the right to confirm. */
  async applyCredit(user: AuthUser, customerId: string, dto: ApplyCreditDto): Promise<PaymentDto> {
    const amount = D(dto.amount);
    if (!amount.gt(0)) throw new ValidationFailedException({ amount: ['must be more than zero'] });
    await this.assertCustomer(customerId);
    const order = await this.orders.row(user, dto.orderId);
    if (order.customerId !== customerId) {
      throw new ValidationFailedException({ orderId: ['belongs to another customer'] });
    }
    await this.assertPayable(order);

    const payment = await this.prisma.scoped.$transaction(async (tx) => {
      await lockOrder(tx, order.id);
      await lockCustomer(tx, customerId);
      const fresh = await tx.order.findFirstOrThrow({ where: { id: order.id } });
      await this.assertPayable(fresh);
      const owed = D(fresh.balanceDue.toFixed());
      if (amount.gt(owed)) {
        throw new ValidationFailedException({
          amount: [`is more than the ${owed.toFixed()} still owed on this order`],
        });
      }
      const balance = D(await customerCredit(tx, customerId));
      if (amount.gt(balance)) {
        throw new ValidationFailedException({
          amount: [`is more than the customer's credit of ${balance.toFixed()}`],
        });
      }
      const row = await tx.payment.create({
        data: {
          workspaceId: user.workspaceId,
          paymentNumber: await this.numbering.next(tx, 'PAYMENT'),
          type: 'CREDIT_APPLIED',
          status: 'CONFIRMED',
          orderId: order.id,
          customerId,
          amount: amount.toFixed(),
          recordedById: user.userId,
          confirmedById: user.userId,
          confirmedAt: new Date(),
          note: 'Customer credit applied',
        },
      });
      await tx.customerCredit.create({
        data: {
          workspaceId: user.workspaceId,
          customerId,
          amount: amount.negated().toFixed(),
          reason: 'APPLIED',
          paymentId: row.id,
          orderId: order.id,
          createdById: user.userId,
        },
      });
      await this.onConfirmed(tx, user, row);
      await this.audit.record(tx, {
        action: 'payment.apply_credit',
        entityType: 'Payment',
        entityId: row.id,
        after: audited(toPaymentDto(row)),
      });
      return row;
    });
    await this.afterChange(user, payment, 'paid from the customer credit');
    await this.publishConfirmed(user, payment);
    return toPaymentDto(payment);
  }

  /** An overpayment becomes the customer's credit with one action (Requirement 40.8). */
  async moveOverpaymentToCredit(user: AuthUser, orderId: string): Promise<PaymentDto> {
    const order = await this.orders.row(user, orderId);
    const payment = await this.prisma.scoped.$transaction(async (tx) => {
      await lockOrder(tx, orderId);
      await lockCustomer(tx, order.customerId);
      const { order: fresh } = await recalculateOrder(tx, orderId);
      const over = D(fresh.balanceDue.toFixed()).negated();
      if (!over.gt(0)) throw refuse('This order has not been overpaid');
      const row = await this.refundToCredit(tx, user, fresh, over.toFixed(), 'OVERPAYMENT');
      await this.audit.record(tx, {
        action: 'payment.overpayment_to_credit',
        entityType: 'Payment',
        entityId: row.id,
        after: audited(toPaymentDto(row)),
      });
      return row;
    });
    await this.afterChange(user, payment, 'overpayment moved to the customer credit');
    return toPaymentDto(payment);
  }

  /**
   * Writes the REFUND payment (no method: no money leaves) and the credit row that together move
   * paid money to the customer's credit. Used for overpayments and when an order is cancelled.
   */
  async refundToCredit(
    tx: ScopedTransaction,
    user: { userId: string | null; workspaceId: string },
    order: Order,
    amount: string,
    reason: 'OVERPAYMENT' | 'REFUND_TO_CREDIT',
  ): Promise<Payment> {
    const row = await tx.payment.create({
      data: {
        workspaceId: user.workspaceId,
        paymentNumber: await this.numbering.next(tx, 'PAYMENT'),
        type: 'REFUND',
        status: 'CONFIRMED',
        orderId: order.id,
        customerId: order.customerId,
        amount,
        recordedById: user.userId,
        confirmedById: user.userId,
        confirmedAt: new Date(),
        note:
          reason === 'OVERPAYMENT'
            ? 'Overpayment moved to credit'
            : `Order ${order.orderNumber} cancelled: moved to credit`,
      },
    });
    await tx.customerCredit.create({
      data: {
        workspaceId: user.workspaceId,
        customerId: order.customerId,
        amount,
        reason,
        paymentId: row.id,
        orderId: order.id,
        createdById: user.userId,
      },
    });
    await this.onConfirmed(tx, user, row);
    return row;
  }

  // ── internals ───────────────────────────────────────────────────────────────────────────

  private async load(id: string): Promise<Payment> {
    const payment = await this.prisma.scoped.payment.findFirst({ where: { id } });
    if (!payment) throw new NotFoundAppException();
    return payment;
  }

  private async assertCustomer(customerId: string): Promise<void> {
    if (
      !(await this.prisma.scoped.customer.findFirst({ where: { id: customerId, isWalkIn: false } }))
    ) {
      throw new ValidationFailedException({ customerId: ['does not exist'] });
    }
  }

  /** Money is taken against an order once it is confirmed, and not after it is cancelled. */
  private async assertPayable(order: Order): Promise<void> {
    const workflow = await this.workflows.get('ORDER');
    const role = workflow.states.find((s) => s.key === order.status)?.systemRole;
    if (role === 'DRAFT') throw refuse('Confirm the order before recording a payment');
    if (role === 'CANCELLED') throw refuse('A cancelled order cannot take payments');
  }

  private async assertFileUsable(fileId: string): Promise<void> {
    const file = await this.prisma.scoped.fileAsset.findFirst({ where: { id: fileId } });
    if (!file) throw new ValidationFailedException({ proofFileId: ['does not exist'] });
  }

  private async attachProof(payment: Payment): Promise<void> {
    if (!payment.proofFileId) return;
    await this.files.attach(payment.proofFileId, {
      entityType: 'PAYMENT',
      entityId: payment.id,
      purpose: 'proof',
    });
  }

  /** What follows a payment becoming CONFIRMED, inside its transaction: credit, the order's balance, the receipt. */
  private async onConfirmed(
    tx: ScopedTransaction,
    user: { userId: string | null; workspaceId: string },
    payment: Payment,
  ): Promise<void> {
    if (payment.type === 'ADVANCE' && payment.customerId) {
      await tx.customerCredit.create({
        data: {
          workspaceId: user.workspaceId,
          customerId: payment.customerId,
          amount: payment.amount.toFixed(),
          reason: 'ADVANCE',
          paymentId: payment.id,
          createdById: user.userId,
        },
      });
    }
    let order: Order | null = null;
    if (payment.orderId) order = (await recalculateOrder(tx, payment.orderId)).order;
    await this.issueReceipt(tx, payment, order);
  }

  /** Undoes what confirming did to the customer's credit, refusing when the credit has been spent. */
  private async reverseCredit(
    tx: ScopedTransaction,
    user: AuthUser,
    payment: Payment,
  ): Promise<void> {
    if (!payment.customerId) return;
    const amount = payment.amount.toFixed();
    const credit = (sign: 1 | -1, reason: string) =>
      tx.customerCredit.create({
        data: {
          workspaceId: user.workspaceId,
          customerId: payment.customerId as string,
          amount: sign === 1 ? amount : D(amount).negated().toFixed(),
          reason,
          paymentId: payment.id,
          orderId: payment.orderId,
          createdById: user.userId,
        },
      });
    // money that became credit is taken back out of it, if the customer still has that much
    const takesCredit =
      payment.type === 'ADVANCE' || (payment.type === 'REFUND' && payment.paymentMethodId === null);
    if (takesCredit) {
      const balance = D(await customerCredit(tx, payment.customerId));
      if (D(amount).gt(balance)) {
        throw refuse(
          `The customer has already used this credit (${balance.toFixed()} left); void the payments that spent it first`,
        );
      }
      await credit(-1, 'ADJUSTMENT');
    } else if (payment.type === 'CREDIT_APPLIED') {
      await credit(1, 'ADJUSTMENT'); // the credit it spent comes back
    }
  }

  private async issueReceipt(
    tx: ScopedTransaction,
    payment: Payment,
    order: Order | null,
  ): Promise<void> {
    if (payment.type === 'REFUND' && payment.paymentMethodId === null) return; // no money changed hands
    const [business, locale, customer, method] = await Promise.all([
      this.settings.get<Record<string, string>>('business'),
      this.settings.get<{ currency: string; currencyDecimals: number }>('locale'),
      payment.customerId
        ? tx.customer.findFirst({ where: { id: payment.customerId } })
        : Promise.resolve(null),
      payment.paymentMethodId
        ? tx.paymentMethod.findFirst({ where: { id: payment.paymentMethodId } })
        : Promise.resolve(null),
    ]);
    await tx.receipt.create({
      data: {
        workspaceId: payment.workspaceId,
        receiptNumber: await this.numbering.next(tx, 'RECEIPT'),
        orderId: payment.orderId,
        paymentId: payment.id,
        type: 'PAYMENT',
        data: {
          business,
          currency: { code: locale.currency, decimals: locale.currencyDecimals },
          customer: customer ? { id: customer.id, name: customer.fullName } : null,
          payment: {
            number: payment.paymentNumber,
            type: payment.type,
            amount: payment.amount.toFixed(),
            method: method?.name ?? null,
            referenceNumber: payment.referenceNumber,
            paidAt: payment.paidAt.toISOString(),
          },
          order: order
            ? {
                number: order.orderNumber,
                total: order.totalAmount.toFixed(),
                paid: D(order.paidAmount.toFixed()).minus(order.refundedAmount.toFixed()).toFixed(),
                balanceDue: order.balanceDue.toFixed(),
              }
            : null,
        } as Prisma.InputJsonValue,
      },
    });
  }

  /** The timeline entry, and the automatic step to "Deposit paid" when the required deposit is reached. */
  private async afterChange(user: AuthUser, payment: Payment, what: string): Promise<void> {
    await this.timeline.record({
      customerId: payment.customerId ?? undefined,
      orderId: payment.orderId ?? undefined,
      type: 'PAYMENT',
      refType: 'Payment',
      refId: payment.id,
      summary: `Payment ${payment.paymentNumber} of ${payment.amount.toFixed()} ${what}`,
      actorUserId: user.userId,
    });
    if (payment.orderId && payment.status === 'CONFIRMED')
      await this.enterDepositPaid(user, payment.orderId);
  }

  private async publishConfirmed(user: AuthUser, payment: Payment): Promise<void> {
    await this.events.publish('payment.confirmed', {
      workspaceId: user.workspaceId,
      paymentId: payment.id,
      orderId: payment.orderId,
      customerId: payment.customerId,
      actorUserId: user.userId,
    });
  }

  /** A Confirmed order whose confirmed payments reach the required deposit moves to "Deposit paid" by itself. */
  private async enterDepositPaid(user: AuthUser, orderId: string): Promise<void> {
    const order = await this.prisma.scoped.order.findFirst({ where: { id: orderId } });
    if (!order || D(order.depositRequired.toFixed()).lte(0)) return;
    const netPaid = D(order.paidAmount.toFixed()).minus(order.refundedAmount.toFixed());
    if (netPaid.lt(order.depositRequired.toFixed())) return;
    const workflow = await this.workflows.get('ORDER');
    const current = workflow.states.find((s) => s.key === order.status);
    const target = workflow.states.find((s) => s.key === DEPOSIT_PAID_KEY && s.active);
    if (current?.systemRole !== 'CONFIRMED' || !target) return;
    await this.workflows
      .transition('ORDER', orderId, target.key, {
        note: 'Required deposit received',
        actor: { userId: user.userId, permissions: user.permissions, actorType: 'SYSTEM' },
      })
      .catch(() => undefined); // a workspace whose workflow has no such step stays where it is
  }
}
