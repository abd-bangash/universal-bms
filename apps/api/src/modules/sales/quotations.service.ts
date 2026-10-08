import { Injectable } from '@nestjs/common';
import type { Customer, Lead, Prisma, Quotation, QuotationItem } from '@prisma/client';
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
import { PrismaService, type ScopedTransaction } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FieldsService } from '../fields/fields.service';
import { CustomersService } from '../crm/customers.service';
import { LeadsService } from '../crm/leads.service';
import { TimelineService } from '../crm/timeline.service';
import { FilesService } from '../files/files.service';
import { NumberingService } from '../numbering/numbering.service';
import type { DiscountDto } from '../pricing/pricing.dto';
import { PricingService } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { DocumentLinesService } from './document-lines.service';
import type {
  AcceptQuotationDto,
  CreateQuotationDto,
  ListQuotationsQuery,
  RejectQuotationDto,
  SendQuotationDto,
  UpdateQuotationDto,
} from './dto/quotations.dto';
import { json, type LineRow } from './line-rows';
import { OrderFactory } from './order-factory.service';
import { toOrderDto, type OrderDto } from './order.support';
import { loadSnapshotSettings } from '../documents/snapshot-settings';
import { buildQuotationSnapshot } from './quotation-snapshot';
import { toQuotationDto, type QuotationDto } from './quotation.support';

const SORTS = ['createdAt'] as const;
const DAY_MS = 86_400_000;
const EDITABLE = new Set(['DRAFT', 'SENT']);
const audited = (q: QuotationDto): Record<string, unknown> =>
  q as unknown as Record<string, unknown>;

const refuse = (message: string, details?: Record<string, string[]>) =>
  new AppException('VALIDATION_FAILED', 422, message, details);

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricing: PricingService,
    private readonly lines: DocumentLinesService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
    private readonly timeline: TimelineService,
    private readonly events: DomainEventBus,
    private readonly orders: OrderFactory,
    private readonly leads: LeadsService,
    private readonly customers: CustomersService,
    private readonly fields: FieldsService,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────────────────────────

  async list(query: ListQuotationsQuery): Promise<Page<QuotationDto>> {
    const sort = parseSort(query.sort, SORTS, { field: 'createdAt', direction: 'desc' });
    const filters: Prisma.QuotationWhereInput[] = [{ isLatest: true }];
    if (query.status) filters.push({ status: query.status as Quotation['status'] });
    if (query.customerId) filters.push({ customerId: query.customerId });
    if (query.leadId) filters.push({ leadId: query.leadId });
    if (query.q?.trim()) {
      const text = { contains: query.q.trim(), mode: 'insensitive' as const };
      filters.push({
        OR: [
          { quotationNumber: text },
          { customer: { fullName: text } },
          { lead: { fullName: text } },
        ],
      });
    }
    const after = keysetWhere(sort.field, sort.direction, query.cursor, true);
    if (after) filters.push(after as Prisma.QuotationWhereInput);
    const rows = await this.prisma.scoped.quotation.findMany({
      where: { AND: filters },
      orderBy: [{ [sort.field]: sort.direction }, { id: sort.direction }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) => keysetCursor(last.createdAt, last.id)).map((q) =>
      toQuotationDto(q),
    );
  }

  async get(id: string): Promise<QuotationDto> {
    const { quotation, items } = await this.load(id);
    return toQuotationDto(quotation, items);
  }

  async attachments(id: string) {
    await this.load(id);
    return this.files.listForEntity('QUOTATION', id);
  }

  // ── create and edit ─────────────────────────────────────────────────────────────────────

  async create(user: AuthUser, dto: CreateQuotationDto): Promise<QuotationDto> {
    const { customer, lead } = await this.parties(user, dto.customerId, dto.leadId);
    await this.lines.assertAssignee(dto.assignedToId);
    const created = await this.write(user, {
      customerId: customer?.id ?? lead?.customerId ?? null,
      leadId: lead?.id ?? null,
      dto,
      defaults: {
        source: dto.source ?? lead?.source ?? null,
        channel: dto.channel ?? lead?.channel ?? null,
        campaign: dto.campaign ?? lead?.campaign ?? null,
        assignedToId:
          dto.assignedToId === undefined ? (lead?.assignedToId ?? user.userId) : dto.assignedToId,
      },
    });
    await this.timeline.record({
      customerId: created.quotation.customerId ?? undefined,
      leadId: created.quotation.leadId ?? undefined,
      type: 'QUOTATION',
      refType: 'Quotation',
      refId: created.quotation.id,
      summary: `Quotation ${created.quotation.quotationNumber} created`,
      actorUserId: user.userId,
    });
    return toQuotationDto(created.quotation, created.items);
  }

  /** Called by lead conversion: a draft pre-filled from the lead's interest (Requirement 9.4). */
  async createFromLead(
    user: AuthUser,
    lead: Lead,
    customer: Customer,
  ): Promise<{ id: string; number: string }> {
    const lineInput = await this.lines.lineFromLead('QUOTATION_ITEM', lead);
    const quotation = await this.create(user, {
      customerId: customer.id,
      leadId: lead.id,
      lines: [lineInput],
      notes: lead.requirements ?? undefined,
      source: lead.source,
      channel: lead.channel,
      campaign: lead.campaign,
      assignedToId: lead.assignedToId ?? user.userId,
    });
    await this.files.copyAttachments(
      { entityType: 'LEAD', entityId: lead.id },
      { entityType: 'QUOTATION', entityId: quotation.id },
    );
    return { id: quotation.id, number: quotation.quotationNumber };
  }

  async update(user: AuthUser, id: string, dto: UpdateQuotationDto): Promise<QuotationDto> {
    const { quotation: existing, items: existingItems } = await this.load(id);
    if (!EDITABLE.has(existing.status)) {
      throw refuse(`A ${existing.status.toLowerCase()} quotation cannot be edited`);
    }
    if (dto.orderDiscount !== undefined && dto.lines === undefined) {
      throw new ValidationFailedException({
        orderDiscount: ['send the lines together with the discount'],
      });
    }
    if (dto.customerId !== undefined) await this.parties(user, dto.customerId, undefined);
    await this.lines.assertAssignee(dto.assignedToId);

    const before = toQuotationDto(existing, existingItems);
    const updated = await this.write(user, {
      customerId: dto.customerId ?? existing.customerId,
      leadId: existing.leadId,
      existing,
      dto,
      defaults: {
        source: dto.source === undefined ? existing.source : dto.source,
        channel: dto.channel === undefined ? existing.channel : dto.channel,
        campaign: dto.campaign === undefined ? existing.campaign : dto.campaign,
        assignedToId: dto.assignedToId === undefined ? existing.assignedToId : dto.assignedToId,
      },
      before,
    });
    return toQuotationDto(updated.quotation, updated.items);
  }

  // ── sending, accepting, rejecting ───────────────────────────────────────────────────────

  async send(user: AuthUser, id: string, dto: SendQuotationDto): Promise<QuotationDto> {
    const { quotation, items } = await this.load(id);
    if (quotation.status !== 'DRAFT' && quotation.status !== 'SENT') {
      throw refuse(`A ${quotation.status.toLowerCase()} quotation cannot be sent`);
    }
    if (items.length === 0)
      throw refuse('Add at least one line before sending', { lines: ['are required'] });
    if (!quotation.customerId && !quotation.leadId) throw refuse('Choose who the quotation is for');
    this.assertNotExpired(quotation);

    const [customer, lead, config] = await Promise.all([
      quotation.customerId
        ? this.prisma.scoped.customer.findFirst({ where: { id: quotation.customerId } })
        : null,
      quotation.leadId
        ? this.prisma.scoped.lead.findFirst({ where: { id: quotation.leadId } })
        : null,
      this.snapshotSettings(),
    ]);
    const at = new Date();
    const sent = await this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.quotation.update({
        where: { id },
        data: {
          status: 'SENT',
          sentAt: at,
          sentVia: dto.via ?? 'MANUAL',
          version: { increment: 1 },
        },
      });
      const snapshot = buildQuotationSnapshot({
        quotation: row,
        items,
        customer,
        lead,
        settings: config,
        at,
      });
      const withSnapshot = await tx.quotation.update({
        where: { id },
        data: { sentSnapshot: json(snapshot) },
      });
      await this.audit.record(tx, {
        action: 'quotation.send',
        entityType: 'Quotation',
        entityId: id,
        before: { status: quotation.status },
        after: { status: 'SENT', sentVia: row.sentVia },
      });
      return withSnapshot;
    });
    await this.timeline.record({
      customerId: sent.customerId ?? undefined,
      leadId: sent.leadId ?? undefined,
      type: 'QUOTATION',
      refType: 'Quotation',
      refId: id,
      summary: `Quotation ${sent.quotationNumber} sent`,
      actorUserId: user.userId,
    });
    await this.events.publish('quotation.sent', {
      workspaceId: user.workspaceId,
      quotationId: id,
      actorUserId: user.userId,
    });
    return toQuotationDto(sent, items);
  }

  /** Records that the customer said yes: who recorded it, when, how, and an optional attachment (Requirement 39.4). */
  async accept(user: AuthUser, id: string, dto: AcceptQuotationDto): Promise<QuotationDto> {
    const { quotation, items } = await this.load(id);
    if (quotation.status !== 'SENT')
      throw refuse(
        `Only a sent quotation can be accepted (this one is ${quotation.status.toLowerCase()})`,
      );
    this.assertNotExpired(quotation);
    if (dto.fileId) {
      await this.files.attach(dto.fileId, {
        entityType: 'QUOTATION',
        entityId: id,
        purpose: 'proof',
      });
    }
    const accepted = await this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.quotation.update({
        where: { id },
        data: {
          status: 'ACCEPTED',
          acceptedAt: new Date(),
          acceptedVia: dto.via,
          acceptanceRecordedById: user.userId,
          acceptanceFileId: dto.fileId ?? null,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        action: 'quotation.accept',
        entityType: 'Quotation',
        entityId: id,
        before: { status: 'SENT' },
        after: { status: 'ACCEPTED', acceptedVia: dto.via, acceptanceFileId: dto.fileId ?? null },
      });
      return row;
    });
    await this.timeline.record({
      customerId: accepted.customerId ?? undefined,
      leadId: accepted.leadId ?? undefined,
      type: 'QUOTATION',
      refType: 'Quotation',
      refId: id,
      summary: `Quotation ${accepted.quotationNumber} accepted (${dto.via.toLowerCase().replace('_', ' ')})`,
      actorUserId: user.userId,
    });
    await this.events.publish('quotation.accepted', {
      workspaceId: user.workspaceId,
      quotationId: id,
      actorUserId: user.userId,
    });
    return toQuotationDto(accepted, items);
  }

  async reject(user: AuthUser, id: string, dto: RejectQuotationDto): Promise<QuotationDto> {
    const { quotation, items } = await this.load(id);
    if (quotation.status !== 'SENT' && quotation.status !== 'DRAFT') {
      throw refuse(`A ${quotation.status.toLowerCase()} quotation cannot be rejected`);
    }
    const rejected = await this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.quotation.update({
        where: { id },
        data: { status: 'REJECTED', rejectedReason: dto.reason.trim(), version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'quotation.reject',
        entityType: 'Quotation',
        entityId: id,
        before: { status: quotation.status },
        after: { status: 'REJECTED', reason: dto.reason.trim() },
      });
      return row;
    });
    await this.timeline.record({
      customerId: rejected.customerId ?? undefined,
      leadId: rejected.leadId ?? undefined,
      type: 'QUOTATION',
      refType: 'Quotation',
      refId: id,
      summary: `Quotation ${rejected.quotationNumber} rejected: ${dto.reason.trim()}`,
      actorUserId: user.userId,
    });
    return toQuotationDto(rejected, items);
  }

  // ── conversion to an order (Requirement 10.4) ───────────────────────────────────────────

  /**
   * Makes the Order from an accepted quotation in one transaction: same lines, prices, custom
   * fields and attachments, same attribution. The quotation becomes CONVERTED.
   */
  async convert(user: AuthUser, id: string): Promise<{ order: OrderDto; quotation: QuotationDto }> {
    const { quotation, items } = await this.load(id);
    if (quotation.status === 'CONVERTED') throw refuse('This quotation has already been converted');
    if (quotation.status === 'EXPIRED')
      throw refuse('This quotation has expired and cannot be converted');
    if (quotation.status !== 'ACCEPTED') {
      throw refuse(
        `Only an accepted quotation can be converted (this one is ${quotation.status.toLowerCase()})`,
      );
    }
    if (items.length === 0) throw refuse('The quotation has no lines');

    let customerId = quotation.customerId;
    if (!customerId && quotation.leadId) {
      // an enquiry that has not become a customer yet does so now
      customerId = (await this.leads.convert(user, quotation.leadId, { target: 'CUSTOMER' }))
        .customer.id;
    }
    if (!customerId) throw refuse('Choose a customer before converting');

    const productIds = [...new Set(items.map((i) => i.productId).filter((p): p is string => !!p))];
    const products = await this.prisma.scoped.product.findMany({
      where: { id: { in: productIds } },
    });
    const stocked = new Set(
      products.filter((p) => p.type === 'STOCKABLE' && !p.madeToOrder).map((p) => p.id),
    );
    const rows: LineRow[] = items.map((i) => ({
      lineNo: i.lineNo,
      kind: i.kind,
      productId: i.productId,
      variantId: i.variantId,
      name: i.name,
      sku: i.sku,
      description: i.description,
      quantity: i.quantity.toFixed(),
      unitId: i.unitId,
      listPrice: i.listPrice.toFixed(),
      unitPrice: i.unitPrice.toFixed(),
      discountType: i.discountType,
      discountValue: i.discountValue.toFixed(),
      discountAmount: i.discountAmount.toFixed(),
      taxClassId: i.taxClassId,
      taxRate: i.taxRate.toFixed(),
      taxAmount: i.taxAmount.toFixed(),
      lineTotal: i.lineTotal.toFixed(),
      customFields: i.customFields as Record<string, unknown>,
      fieldSnapshot: i.fieldSnapshot as LineRow['fieldSnapshot'],
      stockTracked: i.productId !== null && stocked.has(i.productId),
      notes: null,
    }));

    const result = await this.prisma.scoped.$transaction(async (tx) => {
      const { order, items: orderItems } = await this.orders.create(tx, user, {
        customerId: customerId as string,
        leadId: quotation.leadId,
        quotationId: quotation.id,
        orderType: rows.some((r) => r.kind === 'CUSTOM') ? 'CUSTOM' : 'STANDARD',
        source: quotation.source ?? 'MANUAL',
        channel: quotation.channel,
        campaign: quotation.campaign,
        assignedToId: quotation.assignedToId ?? user.userId,
        notes: quotation.notes,
        customFields: {},
        discount: quotation.discountType
          ? { type: quotation.discountType, value: quotation.discountValue.toFixed() }
          : null,
        totals: {
          subtotal: quotation.subtotal.toFixed(),
          discountAmount: quotation.discountAmount.toFixed(),
          taxAmount: quotation.taxAmount.toFixed(),
          roundingAmount: '0',
          totalAmount: quotation.totalAmount.toFixed(),
        },
        lines: rows,
      });
      await this.files.copyAttachments(
        { entityType: 'QUOTATION', entityId: quotation.id },
        { entityType: 'ORDER', entityId: order.id },
        tx,
      );
      const converted = await tx.quotation.update({
        where: { id },
        data: { status: 'CONVERTED', customerId, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'quotation.convert',
        entityType: 'Quotation',
        entityId: id,
        before: { status: 'ACCEPTED' },
        after: { status: 'CONVERTED', orderId: order.id, orderNumber: order.orderNumber },
      });
      return { order, orderItems, converted };
    });

    await this.timeline.record({
      customerId: customerId,
      leadId: quotation.leadId ?? undefined,
      orderId: result.order.id,
      type: 'ORDER',
      refType: 'Order',
      refId: result.order.id,
      summary: `Order ${result.order.orderNumber} created from quotation ${quotation.quotationNumber}`,
      actorUserId: user.userId,
    });
    await this.events.publish('order.created', {
      workspaceId: user.workspaceId,
      orderId: result.order.id,
      actorUserId: user.userId,
    });
    return {
      order: toOrderDto(result.order, {
        items: result.orderItems,
        canViewCost: user.permissions.includes('product:view_cost'),
      }),
      quotation: toQuotationDto(result.converted, items),
    };
  }

  // ── the daily expiry (Requirement 10.5) ─────────────────────────────────────────────────

  /** Marks the sent quotations of the workspace in context whose date has passed as EXPIRED. */
  async expireDue(workspaceId: string, now = new Date()): Promise<number> {
    const due = await this.prisma.scoped.quotation.findMany({
      where: { status: 'SENT', validUntil: { lt: now }, isLatest: true },
      select: { id: true, quotationNumber: true, customerId: true, leadId: true },
    });
    let expired = 0;
    for (const q of due) {
      const claimed = await this.prisma.scoped.quotation.updateMany({
        where: { id: q.id, status: 'SENT' },
        data: { status: 'EXPIRED', version: { increment: 1 } },
      });
      if (claimed.count === 0) continue;
      expired += 1;
      await this.timeline.record({
        customerId: q.customerId ?? undefined,
        leadId: q.leadId ?? undefined,
        type: 'QUOTATION',
        refType: 'Quotation',
        refId: q.id,
        summary: `Quotation ${q.quotationNumber} expired`,
        actorUserId: null,
      });
      await this.events.publish('quotation.expired', {
        workspaceId,
        quotationId: q.id,
        actorUserId: null,
      });
    }
    return expired;
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────

  private async load(id: string): Promise<{ quotation: Quotation; items: QuotationItem[] }> {
    const quotation = await this.prisma.scoped.quotation.findFirst({
      where: { id },
      include: { items: { orderBy: { lineNo: 'asc' } } },
    });
    if (!quotation) throw new NotFoundAppException();
    const { items, ...rest } = quotation;
    return { quotation: rest as Quotation, items };
  }

  private assertNotExpired(quotation: Quotation): void {
    if (quotation.validUntil && quotation.validUntil.getTime() < Date.now()) {
      throw refuse('This quotation has passed its valid-until date');
    }
  }

  /** The customer and lead a quotation is for; at least one is needed, and both must be visible to the user. */
  private async parties(
    user: AuthUser,
    customerId: string | undefined,
    leadId: string | undefined,
  ): Promise<{ customer: Customer | null; lead: Lead | null }> {
    if (!customerId && !leadId) {
      throw new ValidationFailedException({ customerId: ['choose a customer or a lead'] });
    }
    const customer = customerId
      ? await this.prisma.scoped.customer.findFirst({ where: { id: customerId, isWalkIn: false } })
      : null;
    if (customerId && !customer)
      throw new ValidationFailedException({ customerId: ['does not exist'] });
    const lead = leadId ? await this.leads.row(user, leadId).catch(() => null) : null;
    if (leadId && !lead) throw new ValidationFailedException({ leadId: ['does not exist'] });
    return { customer, lead };
  }

  private snapshotSettings() {
    return loadSnapshotSettings(this.settings);
  }

  /** Prices the lines, writes the quotation and its items, audits overrides. Shared by create and update. */
  private async write(
    user: AuthUser,
    input: {
      customerId: string | null;
      leadId: string | null;
      existing?: Quotation;
      dto: CreateQuotationDto | UpdateQuotationDto;
      defaults: {
        source: string | null;
        channel: string | null;
        campaign: string | null;
        assignedToId: string | null;
      };
      before?: QuotationDto;
    },
  ): Promise<{ quotation: Quotation; items: QuotationItem[] }> {
    const { dto, existing } = input;
    const pricing =
      dto.lines !== undefined
        ? await this.pricing.price(user, {
            lines: dto.lines,
            orderDiscount: dto.orderDiscount ?? null,
            customerId: input.customerId,
          })
        : null;
    const rows = pricing ? await this.lines.rows('QUOTATION_ITEM', pricing) : null;
    const totals = pricing ? this.lines.totals(pricing) : null;
    const validity = await this.settings.get<number>('documents.quotationValidityDays');
    const validUntil =
      dto.validUntil === undefined
        ? existing
          ? existing.validUntil
          : new Date(Date.now() + validity * DAY_MS)
        : dto.validUntil
          ? new Date(dto.validUntil)
          : null;
    const customFields =
      dto.customFields === undefined
        ? existing
          ? undefined
          : {}
        : await this.fields.validate('QUOTATION', dto.customFields, {
            existing: existing?.customFields as Record<string, unknown> | undefined,
          });

    return this.prisma.scoped.$transaction(async (tx: ScopedTransaction) => {
      let quotation: Quotation;
      if (existing) {
        const result = await tx.quotation.updateMany({
          where: { id: existing.id, version: (dto as UpdateQuotationDto).version },
          data: {
            customerId: input.customerId,
            validUntil,
            notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
            terms: dto.terms === undefined ? undefined : dto.terms?.trim() || null,
            source: input.defaults.source,
            channel: input.defaults.channel,
            campaign: input.defaults.campaign,
            assignedToId: input.defaults.assignedToId,
            customFields: customFields ? json(customFields) : undefined,
            ...(totals
              ? {
                  subtotal: totals.subtotal,
                  discountType: dto.orderDiscount?.type ?? null,
                  discountValue: dto.orderDiscount?.value ?? '0',
                  discountAmount: totals.discountAmount,
                  taxAmount: totals.taxAmount,
                  totalAmount: totals.totalAmount,
                }
              : {}),
            version: { increment: 1 },
          },
        });
        if (result.count === 0) {
          throw new AppException(
            'STALE_VERSION',
            409,
            'This quotation was changed by someone else; reload and try again',
          );
        }
        quotation = await tx.quotation.findFirstOrThrow({ where: { id: existing.id } });
      } else {
        const number = await this.numbering.next(tx, 'QUOTATION');
        const t = totals ?? {
          subtotal: '0',
          discountAmount: '0',
          taxAmount: '0',
          roundingAmount: '0',
          totalAmount: '0',
        };
        quotation = await tx.quotation.create({
          data: {
            workspaceId: user.workspaceId,
            quotationNumber: number,
            customerId: input.customerId,
            leadId: input.leadId,
            validUntil,
            subtotal: t.subtotal,
            discountType: dto.orderDiscount?.type ?? null,
            discountValue: dto.orderDiscount?.value ?? '0',
            discountAmount: t.discountAmount,
            taxAmount: t.taxAmount,
            totalAmount: t.totalAmount,
            notes: dto.notes?.trim() || null,
            terms: dto.terms?.trim() || null,
            source: input.defaults.source,
            channel: input.defaults.channel,
            campaign: input.defaults.campaign,
            assignedToId: input.defaults.assignedToId,
            customFields: json(customFields ?? {}),
            createdById: user.userId,
          },
        });
      }
      if (rows) {
        await tx.quotationItem.deleteMany({ where: { quotationId: quotation.id } });
        for (const row of rows) {
          await tx.quotationItem.create({
            data: {
              workspaceId: user.workspaceId,
              quotationId: quotation.id,
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
              customFields: json(row.customFields),
              fieldSnapshot: json(row.fieldSnapshot),
            },
          });
        }
      }
      const items = await tx.quotationItem.findMany({
        where: { quotationId: quotation.id },
        orderBy: { lineNo: 'asc' },
      });
      if (pricing) await this.lines.auditOverrides(tx, user, 'Quotation', quotation.id, pricing);
      await this.audit.record(tx, {
        action: existing ? 'quotation.update' : 'quotation.create',
        entityType: 'Quotation',
        entityId: quotation.id,
        before: input.before ? audited(input.before) : undefined,
        after: audited(toQuotationDto(quotation, items)),
        metadata: existing?.status === 'SENT' ? { editedAfterSending: true } : undefined,
      });
      return { quotation, items };
    });
  }
}

export type { DiscountDto };
