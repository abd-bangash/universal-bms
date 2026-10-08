import { Injectable } from '@nestjs/common';
import { Prisma, type Customer } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import type { RequestContext } from '../../common/context/request-context';
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
import { FieldsService } from '../fields/fields.service';
import { cleanTags, digitsOf, toCustomerDto, type CustomerDto } from './customer.support';
import { DuplicateDetectionService } from './duplicate-detection.service';
import type { CreateCustomerDto, ListCustomersQuery, UpdateCustomerDto } from './dto/customers.dto';
import { PhoneService } from './phone.service';

const SORTS = ['fullName', 'createdAt'] as const;
const audited = (c: CustomerDto): Record<string, unknown> =>
  c as unknown as Record<string, unknown>;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: FieldsService,
    private readonly phones: PhoneService,
    private readonly duplicates: DuplicateDetectionService,
    private readonly events: DomainEventBus,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────────────────────────

  async list(query: ListCustomersQuery, raw: Record<string, unknown>): Promise<Page<CustomerDto>> {
    const sort = parseSort(query.sort, SORTS, { field: 'fullName', direction: 'asc' });
    const filters: Prisma.CustomerWhereInput[] = [
      { isWalkIn: false }, // the walk-in customer is never listed (Requirement 12.10)
      { status: query.status ?? 'ACTIVE' },
    ];
    if (query.tag) filters.push({ tags: { has: query.tag } });
    if (query.assignedToId) filters.push({ assignedToId: query.assignedToId });
    if (query.source) filters.push({ source: query.source });
    if (query.email) filters.push({ email: query.email.trim() });
    if (query.phone) {
      const e164 = await this.phones.normalizeOne(query.phone, 'phone');
      filters.push({ phonesNormalized: { has: e164 } });
    }
    if (query.q?.trim()) filters.push({ id: { in: await this.searchIds(query.q.trim()) } });
    const cfIds = await this.fields.matchingIds('customers', 'CUSTOMER', raw);
    if (cfIds) filters.push({ id: { in: cfIds } });
    const after = keysetWhere(sort.field, sort.direction, query.cursor, sort.field === 'createdAt');
    if (after) filters.push(after as Prisma.CustomerWhereInput);

    const rows = await this.prisma.scoped.customer.findMany({
      where: { AND: filters },
      orderBy: [{ [sort.field]: sort.direction }, { id: sort.direction }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) =>
      keysetCursor(last[sort.field as 'fullName' | 'createdAt'], last.id),
    ).map(toCustomerDto);
  }

  async get(id: string): Promise<CustomerDto> {
    return toCustomerDto(await this.row(id));
  }

  /** The system customer for anonymous counter sales; used by POS, never exposed through the API. */
  async walkIn(): Promise<Customer> {
    return this.prisma.scoped.customer.findFirstOrThrow({ where: { isWalkIn: true } });
  }

  // ── writes ──────────────────────────────────────────────────────────────────────────────

  async create(actor: AuthUser, dto: CreateCustomerDto): Promise<CustomerDto> {
    const { phones, normalized } = await this.phones.normalizeMany(dto.phones ?? []);
    const email = dto.email?.trim().toLowerCase() || null;
    const fullName = dto.fullName.trim();
    await this.checkDuplicates(
      { phonesNormalized: normalized, email, fullName },
      dto.confirmDuplicate,
    );
    await this.assertReferences(dto);
    const customFields = await this.fields.validate('CUSTOMER', dto.customFields ?? {});

    const created = await this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.customer.create({
        data: {
          workspaceId: actor.workspaceId,
          fullName,
          phones,
          phonesNormalized: normalized,
          email,
          billingAddress: json(dto.billingAddress),
          shippingAddress: json(dto.shippingAddress),
          preferredChannel: dto.preferredChannel ?? null,
          notes: dto.notes?.trim() || null,
          tags: cleanTags(dto.tags) ?? [],
          source: dto.source?.trim() || null,
          channel: dto.channel?.trim() || null,
          campaign: dto.campaign?.trim() || null,
          assignedToId: dto.assignedToId ?? null,
          priceListId: dto.priceListId ?? null,
          customFields: customFields as Prisma.InputJsonValue,
        },
      });
      await this.audit.record(tx, {
        action: 'customer.create',
        entityType: 'Customer',
        entityId: row.id,
        after: audited(toCustomerDto(row)),
      });
      return row;
    });
    await this.events.publish('customer.created', {
      workspaceId: actor.workspaceId,
      customerId: created.id,
      actorUserId: actor.userId,
    });
    return toCustomerDto(created);
  }

  async update(actor: AuthUser, id: string, dto: UpdateCustomerDto): Promise<CustomerDto> {
    const existing = await this.row(id);
    if (existing.status === 'ARCHIVED') {
      throw new AppException(
        'VALIDATION_FAILED',
        422,
        'An archived customer cannot be edited; restore it first',
      );
    }

    let phones = existing.phones;
    let normalized = existing.phonesNormalized;
    if (dto.phones !== undefined)
      ({ phones, normalized } = await this.phones.normalizeMany(dto.phones));
    const email =
      dto.email === undefined ? existing.email : dto.email?.trim().toLowerCase() || null;
    const fullName = dto.fullName?.trim() ?? existing.fullName;

    const identityChanged =
      dto.phones !== undefined || dto.email !== undefined || fullName !== existing.fullName;
    if (identityChanged) {
      await this.checkDuplicates(
        { phonesNormalized: normalized, email, fullName, excludeId: id },
        dto.confirmDuplicate,
      );
    }
    await this.assertReferences(dto);
    const customFields =
      dto.customFields === undefined
        ? undefined
        : await this.fields.validate('CUSTOMER', dto.customFields, {
            existing: existing.customFields as Record<string, unknown>,
          });

    const updated = await this.prisma.scoped.$transaction(async (tx) => {
      const result = await tx.customer.updateMany({
        where: { id, version: dto.version },
        data: {
          fullName,
          phones,
          phonesNormalized: normalized,
          email,
          billingAddress: dto.billingAddress === undefined ? undefined : json(dto.billingAddress),
          shippingAddress:
            dto.shippingAddress === undefined ? undefined : json(dto.shippingAddress),
          preferredChannel: dto.preferredChannel,
          notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
          tags: cleanTags(dto.tags),
          source: dto.source === undefined ? undefined : dto.source?.trim() || null,
          channel: dto.channel === undefined ? undefined : dto.channel?.trim() || null,
          campaign: dto.campaign === undefined ? undefined : dto.campaign?.trim() || null,
          assignedToId: dto.assignedToId,
          priceListId: dto.priceListId,
          customFields: customFields as Prisma.InputJsonValue | undefined,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw staleVersion();
      const row = await tx.customer.findFirstOrThrow({ where: { id } });
      await this.audit.record(tx, {
        action: 'customer.update',
        entityType: 'Customer',
        entityId: id,
        before: audited(toCustomerDto(existing)),
        after: audited(toCustomerDto(row)),
      });
      return row;
    });
    return toCustomerDto(updated);
  }

  async archive(actor: AuthUser, id: string): Promise<CustomerDto> {
    return this.setStatus(actor, id, 'ARCHIVED');
  }

  async restore(actor: AuthUser, id: string): Promise<CustomerDto> {
    return this.setStatus(actor, id, 'ACTIVE');
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────

  private async setStatus(actor: AuthUser, id: string, status: 'ACTIVE' | 'ARCHIVED') {
    const existing = await this.row(id);
    if (existing.status === status) return toCustomerDto(existing);
    const row = await this.prisma.scoped.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id },
        data: { status, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: status === 'ARCHIVED' ? 'customer.archive' : 'customer.restore',
        entityType: 'Customer',
        entityId: id,
        before: { status: existing.status },
        after: { status },
      });
      return updated;
    });
    void actor;
    return toCustomerDto(row);
  }

  /** A hidden walk-in customer and other workspaces' customers are simply not found. */
  private async row(id: string): Promise<Customer> {
    const row = await this.prisma.scoped.customer.findFirst({ where: { id, isWalkIn: false } });
    if (!row) throw new NotFoundAppException();
    return row;
  }

  private async checkDuplicates(
    input: Parameters<DuplicateDetectionService['find']>[0],
    confirmed: boolean | undefined,
  ): Promise<void> {
    if (confirmed) return;
    const candidates = await this.duplicates.find(input);
    if (candidates.length > 0) {
      throw new AppException(
        'POSSIBLE_DUPLICATE',
        409,
        'A customer like this already exists',
        undefined,
        { hasDuplicates: true, candidates },
      );
    }
  }

  private async assertReferences(dto: {
    assignedToId?: string | null;
    priceListId?: string | null;
  }): Promise<void> {
    const errors: Record<string, string[]> = {};
    if (dto.assignedToId) {
      const member = await this.prisma.scoped.userWorkspace.findFirst({
        where: { userId: dto.assignedToId, status: 'ACTIVE' },
      });
      if (!member) errors.assignedToId = ['must be an active member of this workspace'];
    }
    if (dto.priceListId) {
      const list = await this.prisma.scoped.priceList.findFirst({ where: { id: dto.priceListId } });
      if (!list) errors.priceListId = ['does not exist'];
    }
    if (Object.keys(errors).length > 0) throw new ValidationFailedException(errors);
  }

  /** Name, email and phone-fragment search (Requirement 8.5). */
  private async searchIds(q: string): Promise<string[]> {
    const workspaceId = this.cls.get('workspaceId');
    if (!workspaceId) throw new Error('No workspace in context');
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const digits = digitsOf(q);
    const phoneMatch =
      digits.length >= 3
        ? Prisma.sql`OR EXISTS (SELECT 1 FROM unnest(phones_normalized) AS p WHERE p LIKE ${`%${digits}%`})`
        : Prisma.empty;
    const rows = await this.prisma.scoped.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM customers
      WHERE workspace_id = ${workspaceId} AND NOT is_walk_in
        AND (full_name ILIKE ${like} OR email ILIKE ${like} ${phoneMatch})
      LIMIT 2000`;
    return rows.map((r) => r.id);
  }
}

const staleVersion = () =>
  new AppException(
    'STALE_VERSION',
    409,
    'This customer was changed by someone else; reload and try again',
  );

const json = (value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  value === undefined || value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
