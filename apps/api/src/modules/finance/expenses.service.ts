import { Injectable } from '@nestjs/common';
import type { Expense, ExpenseCategory, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
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
import { FilesService } from '../files/files.service';
import type {
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  ListExpensesQuery,
  UpdateExpenseCategoryDto,
} from './dto/expenses.dto';

export interface ExpenseCategoryDto {
  id: string;
  name: string;
  active: boolean;
}

export interface ExpenseDto {
  id: string;
  categoryId: string;
  amount: string;
  expenseDate: string;
  paymentMethodId: string;
  accountId: string;
  description: string | null;
  attachmentFileId: string | null;
  status: string;
  voidReason: string | null;
  customFields: Record<string, unknown>;
  recordedById: string | null;
  createdAt: string;
}

const categoryDto = (c: ExpenseCategory): ExpenseCategoryDto => ({
  id: c.id,
  name: c.name,
  active: c.active,
});
const expenseDto = (e: Expense): ExpenseDto => ({
  id: e.id,
  categoryId: e.categoryId,
  amount: e.amount.toFixed(),
  expenseDate: e.expenseDate.toISOString(),
  paymentMethodId: e.paymentMethodId,
  accountId: e.accountId,
  description: e.description,
  attachmentFileId: e.attachmentFileId,
  status: e.status,
  voidReason: e.voidReason,
  customFields: e.customFields as Record<string, unknown>,
  recordedById: e.recordedById,
  createdAt: e.createdAt.toISOString(),
});
const audited = (v: object): Record<string, unknown> => v as Record<string, unknown>;

/** Expense categories and expenses (Requirements 13.3, 13.9, 13.10). A posted expense is never edited. */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: FieldsService,
    private readonly files: FilesService,
  ) {}

  // ── categories ──────────────────────────────────────────────────────────────────────────

  async listCategories(includeInactive = false): Promise<ExpenseCategoryDto[]> {
    const rows = await this.prisma.scoped.expenseCategory.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
    return rows.map(categoryDto);
  }

  async createCategory(user: AuthUser, dto: CreateExpenseCategoryDto): Promise<ExpenseCategoryDto> {
    const name = dto.name.trim();
    await this.assertCategoryNameFree(name);
    return this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.expenseCategory.create({
        data: { workspaceId: user.workspaceId, name },
      });
      await this.audit.record(tx, {
        action: 'expense_category.create',
        entityType: 'ExpenseCategory',
        entityId: row.id,
        after: audited(categoryDto(row)),
      });
      return categoryDto(row);
    });
  }

  async updateCategory(id: string, dto: UpdateExpenseCategoryDto): Promise<ExpenseCategoryDto> {
    const existing = await this.prisma.scoped.expenseCategory.findFirst({ where: { id } });
    if (!existing) throw new NotFoundAppException();
    const name = dto.name?.trim();
    if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertCategoryNameFree(name);
    }
    return this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.expenseCategory.update({
        where: { id },
        data: { name, active: dto.active },
      });
      await this.audit.record(tx, {
        action: 'expense_category.update',
        entityType: 'ExpenseCategory',
        entityId: id,
        before: audited(categoryDto(existing)),
        after: audited(categoryDto(row)),
      });
      return categoryDto(row);
    });
  }

  // ── expenses ────────────────────────────────────────────────────────────────────────────

  async list(query: ListExpensesQuery): Promise<Page<ExpenseDto>> {
    const sort = parseSort(query.sort, ['expenseDate', 'createdAt'] as const, {
      field: 'expenseDate',
      direction: 'desc',
    });
    const filters: Prisma.ExpenseWhereInput[] = [];
    if (query.categoryId) filters.push({ categoryId: query.categoryId });
    if (query.accountId) filters.push({ accountId: query.accountId });
    if (query.status) filters.push({ status: query.status });
    if (query.from) filters.push({ expenseDate: { gte: new Date(query.from) } });
    if (query.to) filters.push({ expenseDate: { lte: new Date(query.to) } });
    if (query.q?.trim()) {
      filters.push({ description: { contains: query.q.trim(), mode: 'insensitive' } });
    }
    const after = keysetWhere(sort.field, sort.direction, query.cursor, true);
    if (after) filters.push(after as Prisma.ExpenseWhereInput);
    const rows = await this.prisma.scoped.expense.findMany({
      where: { AND: filters },
      orderBy: [{ [sort.field]: sort.direction }, { id: sort.direction }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) =>
      keysetCursor(sort.field === 'createdAt' ? last.createdAt : last.expenseDate, last.id),
    ).map(expenseDto);
  }

  async get(id: string): Promise<ExpenseDto> {
    const row = await this.prisma.scoped.expense.findFirst({ where: { id } });
    if (!row) throw new NotFoundAppException();
    return expenseDto(row);
  }

  async create(user: AuthUser, dto: CreateExpenseDto): Promise<ExpenseDto> {
    const amount = D(dto.amount);
    if (!amount.gt(0)) throw new ValidationFailedException({ amount: ['must be more than zero'] });
    const [category, method] = await Promise.all([
      this.prisma.scoped.expenseCategory.findFirst({ where: { id: dto.categoryId, active: true } }),
      this.prisma.scoped.paymentMethod.findFirst({
        where: { id: dto.paymentMethodId, active: true },
        include: { account: true },
      }),
    ]);
    const errors: Record<string, string[]> = {};
    if (!category) errors.categoryId = ['is not an available category'];
    if (!method || !method.account.active)
      errors.paymentMethodId = ['is not an available payment method'];
    if (Object.keys(errors).length > 0) throw new ValidationFailedException(errors);
    if (dto.attachmentFileId) {
      const file = await this.prisma.scoped.fileAsset.findFirst({
        where: { id: dto.attachmentFileId },
      });
      if (!file) throw new ValidationFailedException({ attachmentFileId: ['does not exist'] });
    }
    const customFields = await this.fields.validate('EXPENSE', dto.customFields ?? {}, {});

    const row = await this.prisma.scoped.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          workspaceId: user.workspaceId,
          categoryId: dto.categoryId,
          amount: amount.toFixed(),
          expenseDate: new Date(dto.expenseDate),
          paymentMethodId: dto.paymentMethodId,
          accountId: (method as NonNullable<typeof method>).accountId,
          description: dto.description?.trim() || null,
          attachmentFileId: dto.attachmentFileId ?? null,
          customFields: customFields as Prisma.InputJsonValue,
          recordedById: user.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'expense.create',
        entityType: 'Expense',
        entityId: created.id,
        after: audited(expenseDto(created)),
      });
      return created;
    });
    if (dto.attachmentFileId) {
      await this.files.attach(dto.attachmentFileId, {
        entityType: 'EXPENSE',
        entityId: row.id,
        purpose: 'proof',
      });
    }
    return expenseDto(row);
  }

  /** Corrections are made by voiding with a reason and entering the expense again (Requirement 13.10). */
  async void(user: AuthUser, id: string, reason: string): Promise<ExpenseDto> {
    const existing = await this.prisma.scoped.expense.findFirst({ where: { id } });
    if (!existing) throw new NotFoundAppException();
    return this.prisma.scoped.$transaction(async (tx) => {
      const claimed = await tx.expense.updateMany({
        where: { id, status: 'POSTED' },
        data: { status: 'VOIDED', voidReason: reason.trim() },
      });
      if (claimed.count === 0) {
        throw new AppException('VALIDATION_FAILED', 422, 'This expense is already voided');
      }
      const row = await tx.expense.findFirstOrThrow({ where: { id } });
      await this.audit.record(tx, {
        action: 'expense.void',
        entityType: 'Expense',
        entityId: id,
        before: audited(expenseDto(existing)),
        after: audited(expenseDto(row)),
        metadata: { userId: user.userId },
      });
      return expenseDto(row);
    });
  }

  private async assertCategoryNameFree(name: string): Promise<void> {
    const existing = await this.prisma.scoped.expenseCategory.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing)
      throw new ValidationFailedException({ name: ['is already used by another category'] });
  }
}
