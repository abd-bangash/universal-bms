import { Injectable } from '@nestjs/common';
import type { Prisma, Supplier } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { AppException, NotFoundAppException } from '../../common/errors/app.exception';
import { D } from '../../common/money';
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
import type {
  CreateSupplierDto,
  ListSuppliersQuery,
  UpdateSupplierDto,
} from './dto/purchasing.dto';
import { json } from './purchase.support';

export interface SupplierDto {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: string;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Requirement 22.5: what has been bought, what has been paid, and what is still owed. */
export interface SupplierSummary {
  totalOrdered: string;
  totalReceived: string;
  totalReturned: string;
  totalPaid: string;
  /** received − returned − paid */
  balance: string;
}

const SORTS = ['name', 'createdAt'] as const;
const audited = (s: SupplierDto): Record<string, unknown> =>
  s as unknown as Record<string, unknown>;

export const toSupplierDto = (s: Supplier): SupplierDto => ({
  id: s.id,
  name: s.name,
  contactName: s.contactName,
  phone: s.phone,
  email: s.email,
  address: s.address,
  notes: s.notes,
  status: s.status,
  customFields: s.customFields as Record<string, unknown>,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: FieldsService,
  ) {}

  async list(query: ListSuppliersQuery, raw: Record<string, unknown>): Promise<Page<SupplierDto>> {
    const sort = parseSort(query.sort, SORTS, { field: 'name', direction: 'asc' });
    const filters: Prisma.SupplierWhereInput[] = [{ status: query.status ?? 'ACTIVE' }];
    if (query.q?.trim()) {
      const text = { contains: query.q.trim(), mode: 'insensitive' as const };
      filters.push({
        OR: [{ name: text }, { contactName: text }, { phone: text }, { email: text }],
      });
    }
    const cfIds = await this.fields.matchingIds('suppliers', 'SUPPLIER', raw);
    if (cfIds) filters.push({ id: { in: cfIds } });
    const after = keysetWhere(sort.field, sort.direction, query.cursor, sort.field === 'createdAt');
    if (after) filters.push(after as Prisma.SupplierWhereInput);
    const rows = await this.prisma.scoped.supplier.findMany({
      where: { AND: filters },
      orderBy: [{ [sort.field]: sort.direction }, { id: sort.direction }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) =>
      keysetCursor(last[sort.field as 'name' | 'createdAt'], last.id),
    ).map(toSupplierDto);
  }

  async get(id: string): Promise<SupplierDto & { summary: SupplierSummary }> {
    const row = await this.row(id);
    return { ...toSupplierDto(row), summary: await this.summary(id) };
  }

  async create(actor: AuthUser, dto: CreateSupplierDto): Promise<SupplierDto> {
    const name = dto.name.trim();
    await this.assertNameFree(name);
    const customFields = await this.fields.validate('SUPPLIER', dto.customFields ?? {});
    return this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.supplier.create({
        data: {
          workspaceId: actor.workspaceId,
          name,
          contactName: dto.contactName?.trim() || null,
          phone: dto.phone?.trim() || null,
          email: dto.email?.trim().toLowerCase() || null,
          address: dto.address?.trim() || null,
          notes: dto.notes?.trim() || null,
          customFields: json(customFields),
        },
      });
      await this.audit.record(tx, {
        action: 'supplier.create',
        entityType: 'Supplier',
        entityId: row.id,
        after: audited(toSupplierDto(row)),
      });
      return toSupplierDto(row);
    });
  }

  async update(actor: AuthUser, id: string, dto: UpdateSupplierDto): Promise<SupplierDto> {
    const existing = await this.row(id);
    if (existing.status === 'ARCHIVED') {
      throw new AppException(
        'VALIDATION_FAILED',
        422,
        'An archived supplier cannot be edited; restore it first',
      );
    }
    const name = dto.name?.trim();
    if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertNameFree(name);
    }
    const customFields =
      dto.customFields === undefined
        ? undefined
        : await this.fields.validate('SUPPLIER', dto.customFields, {
            existing: existing.customFields as Record<string, unknown>,
          });
    void actor;
    return this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.supplier.update({
        where: { id },
        data: {
          name,
          contactName: dto.contactName === undefined ? undefined : dto.contactName?.trim() || null,
          phone: dto.phone === undefined ? undefined : dto.phone?.trim() || null,
          email: dto.email === undefined ? undefined : dto.email?.trim().toLowerCase() || null,
          address: dto.address === undefined ? undefined : dto.address?.trim() || null,
          notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
          customFields: customFields ? json(customFields) : undefined,
        },
      });
      await this.audit.record(tx, {
        action: 'supplier.update',
        entityType: 'Supplier',
        entityId: id,
        before: audited(toSupplierDto(existing)),
        after: audited(toSupplierDto(row)),
      });
      return toSupplierDto(row);
    });
  }

  archive(actor: AuthUser, id: string) {
    return this.setStatus(actor, id, 'ARCHIVED');
  }

  restore(actor: AuthUser, id: string) {
    return this.setStatus(actor, id, 'ACTIVE');
  }

  /** Orders placed with the supplier, newest first (Requirement 22.1). */
  async purchases(id: string, limit = 25, cursor?: string) {
    await this.row(id);
    const filters: Prisma.PurchaseOrderWhereInput[] = [{ supplierId: id }];
    const after = keysetWhere('orderDate', 'desc', cursor, true);
    if (after) filters.push(after as Prisma.PurchaseOrderWhereInput);
    const rows = await this.prisma.scoped.purchaseOrder.findMany({
      where: { AND: filters },
      orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toPage(rows, limit, (last) => keysetCursor(last.orderDate, last.id)).map((p) => ({
      id: p.id,
      orderNumber: p.orderNumber,
      status: p.status,
      orderDate: p.orderDate.toISOString(),
      totalAmount: p.totalAmount.toFixed(),
    }));
  }

  async summary(id: string): Promise<SupplierSummary> {
    const items = await this.prisma.scoped.purchaseOrderItem.findMany({
      where: { purchaseOrder: { supplierId: id } },
      select: {
        quantity: true,
        unitCost: true,
        receivedQty: true,
        returnedQty: true,
        purchaseOrder: { select: { status: true } },
      },
    });
    const workflow = await this.prisma.scoped.workflowState.findMany({
      where: { workflow: { entityType: 'PURCHASE_ORDER' }, systemRole: 'CANCELLED' },
      select: { key: true },
    });
    const cancelled = new Set(workflow.map((w) => w.key));
    let ordered = D(0);
    let received = D(0);
    let returned = D(0);
    for (const i of items) {
      const cost = D(i.unitCost.toFixed());
      if (!cancelled.has(i.purchaseOrder.status))
        ordered = ordered.plus(D(i.quantity.toFixed()).mul(cost));
      received = received.plus(D(i.receivedQty.toFixed()).mul(cost));
      returned = returned.plus(D(i.returnedQty.toFixed()).mul(cost));
    }
    const paid = await this.prisma.scoped.supplierPayment.aggregate({
      where: { supplierId: id, status: 'CONFIRMED' },
      _sum: { amount: true },
    });
    const totalPaid = D(paid._sum.amount?.toFixed() ?? '0');
    return {
      totalOrdered: ordered.toFixed(),
      totalReceived: received.toFixed(),
      totalReturned: returned.toFixed(),
      totalPaid: totalPaid.toFixed(),
      balance: received.minus(returned).minus(totalPaid).toFixed(),
    };
  }

  private async setStatus(actor: AuthUser, id: string, status: 'ACTIVE' | 'ARCHIVED') {
    const existing = await this.row(id);
    if (existing.status === status) return toSupplierDto(existing);
    void actor;
    return this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.supplier.update({ where: { id }, data: { status } });
      await this.audit.record(tx, {
        action: status === 'ARCHIVED' ? 'supplier.archive' : 'supplier.restore',
        entityType: 'Supplier',
        entityId: id,
        before: { status: existing.status },
        after: { status },
      });
      return toSupplierDto(row);
    });
  }

  private async row(id: string): Promise<Supplier> {
    const row = await this.prisma.scoped.supplier.findFirst({ where: { id } });
    if (!row) throw new NotFoundAppException();
    return row;
  }

  private async assertNameFree(name: string): Promise<void> {
    const clash = await this.prisma.scoped.supplier.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (clash) {
      throw new AppException('VALIDATION_FAILED', 422, 'A supplier with this name already exists', {
        name: ['is already used by another supplier'],
      });
    }
  }
}
