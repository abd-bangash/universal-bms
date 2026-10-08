import { Injectable } from '@nestjs/common';
import { Prisma, type Lead } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { NotFoundAppException, ValidationFailedException } from '../../common/errors/app.exception';
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
import { FieldsService } from '../fields/fields.service';
import { SettingsService } from '../settings/settings.service';
import { WorkflowService } from '../workflows/workflow.service';
import { toCustomerDto, type CustomerDto } from './customer.support';
import type {
  AssignLeadDto,
  ChangeStageDto,
  ConvertLeadDto,
  CreateLeadDto,
  ListLeadsQuery,
  UpdateLeadDto,
} from './dto/leads.dto';
import { staleLead } from './lead-workflow';
import { KEY_FIELDS, toLeadDto, type LeadDto } from './lead.support';
import { PhoneService } from './phone.service';
import { TimelineService } from './timeline.service';

const SORTS = ['createdAt', 'updatedAt', 'fullName'] as const;
const HOUR_MS = 3_600_000;
const audited = (l: LeadDto): Record<string, unknown> => l as unknown as Record<string, unknown>;

export interface PipelineCard {
  id: string;
  fullName: string;
  phone: string | null;
  interest: string | null;
  estimatedValue: string | null;
  priority: string;
  assignedToId: string | null;
  nextActionDate: string | null;
  updatedAt: string;
}

export interface PipelineColumn {
  stage: string;
  label: string;
  color: string;
  category: string;
  systemRole: string | null;
  count: number;
  value: string;
  cards: PipelineCard[];
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: FieldsService,
    private readonly phones: PhoneService,
    private readonly settings: SettingsService,
    private readonly workflows: WorkflowService,
    private readonly timeline: TimelineService,
    private readonly events: DomainEventBus,
  ) {}

  // ── visibility ──────────────────────────────────────────────────────────────────────────

  /** Without `lead:view_all` a person sees only the leads assigned to or created by them. */
  private scope(user: AuthUser): Prisma.LeadWhereInput {
    return user.permissions.includes('lead:view_all')
      ? {}
      : { OR: [{ assignedToId: user.userId }, { createdById: user.userId }] };
  }

  // ── reads ───────────────────────────────────────────────────────────────────────────────

  async list(
    user: AuthUser,
    query: ListLeadsQuery,
    raw: Record<string, unknown>,
  ): Promise<Page<LeadDto>> {
    const sort = parseSort(query.sort, SORTS, { field: 'createdAt', direction: 'desc' });
    const filters: Prisma.LeadWhereInput[] = [this.scope(user)];
    if (query.stage) filters.push({ stage: query.stage });
    if (query.assignedToId) filters.push({ assignedToId: query.assignedToId });
    if (query.priority) filters.push({ priority: query.priority });
    if (query.source) filters.push({ source: query.source });
    if (query.customerId) filters.push({ customerId: query.customerId });
    if (query.state) {
      const workflow = await this.workflows.get('LEAD');
      const closed = workflow.states
        .filter((s) => s.category === 'DONE' || s.category === 'CANCELLED')
        .map((s) => s.key);
      filters.push({ stage: query.state === 'closed' ? { in: closed } : { notIn: closed } });
    }
    if (query.q?.trim()) {
      const text = { contains: query.q.trim(), mode: 'insensitive' as const };
      filters.push({
        OR: [{ fullName: text }, { interest: text }, { phone: text }, { email: text }],
      });
    }
    const cfIds = await this.fields.matchingIds('leads', 'LEAD', raw);
    if (cfIds) filters.push({ id: { in: cfIds } });
    const after = keysetWhere(sort.field, sort.direction, query.cursor, sort.field !== 'fullName');
    if (after) filters.push(after as Prisma.LeadWhereInput);

    const rows = await this.prisma.scoped.lead.findMany({
      where: { AND: filters },
      orderBy: [{ [sort.field]: sort.direction }, { id: sort.direction }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) =>
      keysetCursor(last[sort.field as 'createdAt' | 'updatedAt' | 'fullName'], last.id),
    ).map(toLeadDto);
  }

  async get(user: AuthUser, id: string): Promise<LeadDto & { allowedTransitions: unknown[] }> {
    const lead = await this.row(user, id);
    const workflow = await this.workflows.get('LEAD');
    return {
      ...toLeadDto(lead),
      allowedTransitions: this.workflows.allowedTransitions(workflow, lead.stage),
    };
  }

  // ── create (with the dedup window, Requirement 9.7) ───────────────────────────────────────

  async create(user: AuthUser, dto: CreateLeadDto): Promise<{ lead: LeadDto; existing: boolean }> {
    const phone = dto.phone?.trim() || null;
    const phoneNormalized = phone ? await this.phones.normalizeOne(phone, 'phone') : null;
    const email = dto.email?.trim().toLowerCase() || null;

    if (!dto.allowDuplicate) {
      const existing = await this.findOpenDuplicate(phoneNormalized, email);
      if (existing) return { lead: toLeadDto(existing), existing: true };
    }
    await this.assertReferences(dto.productId, dto.assignedToId);
    const customFields = await this.fields.validate('LEAD', dto.customFields ?? {});
    const initial = await this.workflows.initialState('LEAD');
    const assignedToId = user.permissions.includes('lead:assign')
      ? (dto.assignedToId ?? null)
      : null;

    const created = await this.prisma.scoped.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          workspaceId: user.workspaceId,
          fullName: dto.fullName.trim(),
          phone,
          phoneNormalized,
          email,
          source: dto.source ?? 'MANUAL',
          channel: dto.channel?.trim() || null,
          campaign: dto.campaign?.trim() || null,
          adId: dto.adId?.trim() || null,
          formId: dto.formId?.trim() || null,
          interest: dto.interest?.trim() || null,
          productId: dto.productId ?? null,
          requirements: dto.requirements?.trim() || null,
          quantity: dto.quantity ?? null,
          estimatedValue: dto.estimatedValue ?? null,
          quotedAmount: dto.quotedAmount ?? null,
          priority: dto.priority ?? 'MEDIUM',
          stage: initial.key,
          assignedToId,
          nextAction: dto.nextAction?.trim() || null,
          nextActionDate: dto.nextActionDate ? new Date(dto.nextActionDate) : null,
          customFields: customFields as Prisma.InputJsonValue,
          createdById: user.userId,
        },
      });
      await tx.statusHistory.create({
        data: {
          workspaceId: user.workspaceId,
          entityType: 'LEAD',
          entityId: lead.id,
          fromKey: null,
          toKey: initial.key,
          changedById: user.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'lead.create',
        entityType: 'Lead',
        entityId: lead.id,
        after: audited(toLeadDto(lead)),
      });
      return lead;
    });
    await this.timeline.record({
      leadId: created.id,
      type: 'SYSTEM',
      refType: 'Lead',
      refId: created.id,
      summary: 'Lead created',
      actorUserId: user.userId,
    });
    await this.events.publish('lead.created', {
      workspaceId: user.workspaceId,
      leadId: created.id,
      actorUserId: user.userId,
    });
    if (assignedToId) {
      await this.events.publish('lead.assigned', {
        workspaceId: user.workspaceId,
        leadId: created.id,
        assignedToId,
        actorUserId: user.userId,
      });
    }
    return { lead: toLeadDto(created), existing: false };
  }

  // ── update ──────────────────────────────────────────────────────────────────────────────

  async update(user: AuthUser, id: string, dto: UpdateLeadDto): Promise<LeadDto> {
    const existing = await this.row(user, id);
    const phone = dto.phone === undefined ? existing.phone : dto.phone?.trim() || null;
    const phoneNormalized =
      dto.phone === undefined
        ? existing.phoneNormalized
        : phone
          ? await this.phones.normalizeOne(phone, 'phone')
          : null;
    await this.assertReferences(dto.productId, undefined);
    const customFields =
      dto.customFields === undefined
        ? undefined
        : await this.fields.validate('LEAD', dto.customFields, {
            existing: existing.customFields as Record<string, unknown>,
          });

    const before = toLeadDto(existing);
    const updated = await this.prisma.scoped.$transaction(async (tx) => {
      const result = await tx.lead.updateMany({
        where: { id, version: dto.version },
        data: {
          fullName: dto.fullName?.trim(),
          phone: dto.phone === undefined ? undefined : phone,
          phoneNormalized: dto.phone === undefined ? undefined : phoneNormalized,
          email: dto.email === undefined ? undefined : dto.email?.trim().toLowerCase() || null,
          source: dto.source,
          channel: dto.channel === undefined ? undefined : dto.channel?.trim() || null,
          campaign: dto.campaign === undefined ? undefined : dto.campaign?.trim() || null,
          adId: dto.adId === undefined ? undefined : dto.adId?.trim() || null,
          formId: dto.formId === undefined ? undefined : dto.formId?.trim() || null,
          interest: dto.interest === undefined ? undefined : dto.interest?.trim() || null,
          productId: dto.productId,
          requirements:
            dto.requirements === undefined ? undefined : dto.requirements?.trim() || null,
          quantity: dto.quantity,
          estimatedValue: dto.estimatedValue,
          quotedAmount: dto.quotedAmount,
          priority: dto.priority,
          nextAction: dto.nextAction === undefined ? undefined : dto.nextAction?.trim() || null,
          nextActionDate:
            dto.nextActionDate === undefined
              ? undefined
              : dto.nextActionDate
                ? new Date(dto.nextActionDate)
                : null,
          customFields: customFields as Prisma.InputJsonValue | undefined,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw staleLead();
      const lead = await tx.lead.findFirstOrThrow({ where: { id } });
      await this.audit.record(tx, {
        action: 'lead.update',
        entityType: 'Lead',
        entityId: id,
        before: audited(before),
        after: audited(toLeadDto(lead)),
      });
      return lead;
    });

    // a history line for each key field that changed (Requirement 9.3)
    const after = toLeadDto(updated);
    for (const { field, label } of KEY_FIELDS) {
      if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
        await this.timeline.record({
          leadId: id,
          type: 'SYSTEM',
          refType: 'Lead',
          refId: id,
          summary: `${label} changed from ${display(before[field])} to ${display(after[field])}`,
          actorUserId: user.userId,
        });
      }
    }
    return after;
  }

  // ── stage, assignment, conversion ───────────────────────────────────────────────────────────

  /** Moves the lead through the workflow engine; Lost needs a reason (Requirement 9.5). */
  async changeStage(user: AuthUser, id: string, dto: ChangeStageDto) {
    await this.row(user, id); // visibility
    return this.workflows.transition('LEAD', id, dto.stage, {
      note: dto.note,
      actor: { userId: user.userId, permissions: user.permissions },
      data: dto.lostReasonId ? { lostReasonId: dto.lostReasonId } : {},
    });
  }

  async assign(user: AuthUser, id: string, dto: AssignLeadDto): Promise<LeadDto> {
    const existing = await this.row(user, id);
    const assignedToId = dto.assignedToId ?? null;
    await this.assertReferences(undefined, assignedToId);
    if (existing.assignedToId === assignedToId) return toLeadDto(existing);
    const updated = await this.prisma.scoped.$transaction(async (tx) => {
      const lead = await tx.lead.update({
        where: { id },
        data: { assignedToId, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'lead.assign',
        entityType: 'Lead',
        entityId: id,
        before: { assignedToId: existing.assignedToId },
        after: { assignedToId },
      });
      return lead;
    });
    const names = await this.names([existing.assignedToId, assignedToId]);
    await this.timeline.record({
      leadId: id,
      type: 'SYSTEM',
      refType: 'Lead',
      refId: id,
      summary: assignedToId
        ? `Assigned to ${names.get(assignedToId) ?? 'a colleague'}${existing.assignedToId ? ` (was ${names.get(existing.assignedToId) ?? 'someone'})` : ''}`
        : 'Unassigned',
      actorUserId: user.userId,
    });
    await this.events.publish('lead.assigned', {
      workspaceId: user.workspaceId,
      leadId: id,
      assignedToId,
      actorUserId: user.userId,
    });
    return toLeadDto(updated);
  }

  /** Turns a lead into a customer: links an existing match or creates a new record (Requirement 9.4). */
  async convert(
    user: AuthUser,
    id: string,
    dto: ConvertLeadDto,
  ): Promise<{ customer: CustomerDto; created: boolean; lead: LeadDto }> {
    const lead = await this.row(user, id);
    if (lead.customerId && !dto.customerId) {
      const linked = await this.prisma.scoped.customer.findFirstOrThrow({
        where: { id: lead.customerId },
      });
      return { customer: toCustomerDto(linked), created: false, lead: toLeadDto(lead) };
    }

    let customerId = dto.customerId ?? null;
    let created = false;
    if (customerId) {
      const target = await this.prisma.scoped.customer.findFirst({
        where: { id: customerId, isWalkIn: false },
      });
      if (!target) throw new ValidationFailedException({ customerId: ['does not exist'] });
    } else if (!dto.createNew) {
      const match = await this.prisma.scoped.customer.findFirst({
        where: {
          isWalkIn: false,
          status: 'ACTIVE',
          OR: [
            ...(lead.phoneNormalized ? [{ phonesNormalized: { has: lead.phoneNormalized } }] : []),
            ...(lead.email ? [{ email: lead.email }] : []),
          ],
        },
      });
      customerId = match?.id ?? null;
    }

    const result = await this.prisma.scoped.$transaction(async (tx) => {
      let customer;
      if (customerId) {
        customer = await tx.customer.findFirstOrThrow({ where: { id: customerId } });
      } else {
        created = true;
        customer = await tx.customer.create({
          data: {
            workspaceId: user.workspaceId,
            fullName: lead.fullName,
            phones: lead.phone ? [lead.phone] : [],
            phonesNormalized: lead.phoneNormalized ? [lead.phoneNormalized] : [],
            email: lead.email,
            source: lead.source,
            channel: lead.channel,
            campaign: lead.campaign,
            assignedToId: lead.assignedToId,
          },
        });
      }
      const updatedLead = await tx.lead.update({
        where: { id },
        data: { customerId: customer.id, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'lead.convert',
        entityType: 'Lead',
        entityId: id,
        after: { target: 'CUSTOMER', customerId: customer.id, created },
      });
      return { customer, lead: updatedLead };
    });

    await this.timeline.record({
      leadId: id,
      customerId: result.customer.id,
      type: 'SYSTEM',
      refType: 'Lead',
      refId: id,
      summary: created ? 'Converted to a new customer' : 'Linked to an existing customer',
      actorUserId: user.userId,
    });
    if (created) {
      await this.events.publish('customer.created', {
        workspaceId: user.workspaceId,
        customerId: result.customer.id,
        actorUserId: user.userId,
      });
    }
    return { customer: toCustomerDto(result.customer), created, lead: toLeadDto(result.lead) };
  }

  // ── pipeline board (Requirement 9.1) ────────────────────────────────────────────────────────

  async pipeline(user: AuthUser, cardsPerColumn = 25): Promise<PipelineColumn[]> {
    const workflow = await this.workflows.get('LEAD');
    const scope = this.scope(user);
    const groups = await this.prisma.scoped.lead.groupBy({
      by: ['stage'],
      where: scope,
      _count: { _all: true },
      _sum: { estimatedValue: true },
    });
    const byStage = new Map(groups.map((g) => [g.stage, g]));
    const columns: PipelineColumn[] = [];
    for (const state of workflow.states.filter((s) => s.active)) {
      const group = byStage.get(state.key);
      const cards = await this.prisma.scoped.lead.findMany({
        where: { AND: [scope, { stage: state.key }] },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: cardsPerColumn,
      });
      columns.push({
        stage: state.key,
        label: state.label,
        color: state.color,
        category: state.category,
        systemRole: state.systemRole,
        count: group?._count._all ?? 0,
        value: group?._sum.estimatedValue?.toFixed() ?? '0',
        cards: cards.map((c) => ({
          id: c.id,
          fullName: c.fullName,
          phone: c.phone,
          interest: c.interest,
          estimatedValue: c.estimatedValue?.toFixed() ?? null,
          priority: c.priority,
          assignedToId: c.assignedToId,
          nextActionDate: c.nextActionDate ? c.nextActionDate.toISOString() : null,
          updatedAt: c.updatedAt.toISOString(),
        })),
      });
    }
    return columns;
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────

  async row(user: AuthUser, id: string): Promise<Lead> {
    const lead = await this.prisma.scoped.lead.findFirst({
      where: { AND: [{ id }, this.scope(user)] },
    });
    if (!lead) throw new NotFoundAppException();
    return lead;
  }

  /** An open lead for the same contact created inside the window, if any. */
  private async findOpenDuplicate(
    phoneNormalized: string | null,
    email: string | null,
  ): Promise<Lead | null> {
    if (!phoneNormalized && !email) return null;
    const hours = await this.settings.get<number>('sales.leadDedupWindowHours');
    if (!(hours > 0)) return null;
    const workflow = await this.workflows.get('LEAD');
    const openKeys = workflow.states
      .filter((s) => s.category === 'OPEN' || s.category === 'IN_PROGRESS')
      .map((s) => s.key);
    return this.prisma.scoped.lead.findFirst({
      where: {
        stage: { in: openKeys },
        createdAt: { gte: new Date(Date.now() - hours * HOUR_MS) },
        OR: [...(phoneNormalized ? [{ phoneNormalized }] : []), ...(email ? [{ email }] : [])],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async assertReferences(
    productId: string | null | undefined,
    assignedToId: string | null | undefined,
  ) {
    const errors: Record<string, string[]> = {};
    if (productId && !(await this.prisma.scoped.product.findFirst({ where: { id: productId } }))) {
      errors.productId = ['does not exist'];
    }
    if (
      assignedToId &&
      !(await this.prisma.scoped.userWorkspace.findFirst({
        where: { userId: assignedToId, status: 'ACTIVE' },
      }))
    ) {
      errors.assignedToId = ['must be an active member of this workspace'];
    }
    if (Object.keys(errors).length > 0) throw new ValidationFailedException(errors);
  }

  private async names(userIds: Array<string | null>): Promise<Map<string, string>> {
    const ids = userIds.filter((i): i is string => !!i);
    if (ids.length === 0) return new Map();
    const members = await this.prisma.scoped.userWorkspace.findMany({
      where: { userId: { in: ids } },
      include: { user: true },
    });
    return new Map(members.map((m) => [m.userId, `${m.user.firstName} ${m.user.lastName}`]));
  }
}

const display = (value: unknown): string =>
  value === null || value === undefined || value === '' ? 'empty' : `"${String(value)}"`;
