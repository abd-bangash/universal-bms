import { Injectable } from '@nestjs/common';
import type { FinancialAccount, PaymentMethod } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { NotFoundAppException, ValidationFailedException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type {
  CreateAccountDto,
  CreateMethodDto,
  UpdateAccountDto,
  UpdateMethodDto,
} from './dto/finance-settings.dto';

/** Accounts that carry bank details; the others are named only. */
const HAS_DETAILS = new Set(['BANK', 'MOBILE_WALLET']);

export interface AccountDto {
  id: string;
  type: string;
  name: string;
  showToCustomers: boolean;
  active: boolean;
  bankName?: string | null;
  accountTitle?: string | null;
  accountNumber?: string | null;
  branch?: string | null;
}

export interface MethodDto {
  id: string;
  name: string;
  type: string;
  accountId: string;
  requiresReference: boolean;
  active: boolean;
}

const methodDto = (m: PaymentMethod): MethodDto => ({
  id: m.id,
  name: m.name,
  type: m.type,
  accountId: m.accountId,
  requiresReference: m.requiresReference,
  active: m.active,
});

const audited = (value: object): Record<string, unknown> => value as Record<string, unknown>;

@Injectable()
export class FinanceSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Staff who only record payments pick an account by name; bank details are for people who manage accounts. */
  private accountDto(a: FinancialAccount, withDetails: boolean): AccountDto {
    return {
      id: a.id,
      type: a.type,
      name: a.name,
      showToCustomers: a.showToCustomers,
      active: a.active,
      ...(withDetails
        ? {
            bankName: a.bankName,
            accountTitle: a.accountTitle,
            accountNumber: a.accountNumber,
            branch: a.branch,
          }
        : {}),
    };
  }

  async listAccounts(user: AuthUser, includeInactive = false): Promise<AccountDto[]> {
    const rows = await this.prisma.scoped.financialAccount.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    const details = user.permissions.includes('account:view');
    return rows.map((a) => this.accountDto(a, details));
  }

  async createAccount(user: AuthUser, dto: CreateAccountDto): Promise<AccountDto> {
    this.assertDetailsAllowed(dto.type, dto);
    await this.assertAccountNameFree(dto.name.trim());
    return this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.financialAccount.create({
        data: {
          workspaceId: user.workspaceId,
          type: dto.type,
          name: dto.name.trim(),
          bankName: dto.bankName?.trim() || null,
          accountTitle: dto.accountTitle?.trim() || null,
          accountNumber: dto.accountNumber?.trim() || null,
          branch: dto.branch?.trim() || null,
          showToCustomers: dto.showToCustomers ?? false,
        },
      });
      await this.audit.record(tx, {
        action: 'account.create',
        entityType: 'FinancialAccount',
        entityId: row.id,
        after: audited(this.accountDto(row, true)),
      });
      return this.accountDto(row, true);
    });
  }

  async updateAccount(id: string, dto: UpdateAccountDto): Promise<AccountDto> {
    const existing = await this.prisma.scoped.financialAccount.findFirst({ where: { id } });
    if (!existing) throw new NotFoundAppException();
    this.assertDetailsAllowed(existing.type, dto);
    if (dto.name !== undefined && dto.name.trim() !== existing.name) {
      await this.assertAccountNameFree(dto.name.trim());
    }
    if (dto.active === false && existing.active) {
      const inUse = await this.prisma.scoped.paymentMethod.count({
        where: { accountId: id, active: true },
      });
      if (inUse > 0) {
        throw new ValidationFailedException({
          active: ['switch off or move the payment methods that use this account first'],
        });
      }
    }
    return this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.financialAccount.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          bankName: dto.bankName === undefined ? undefined : dto.bankName?.trim() || null,
          accountTitle:
            dto.accountTitle === undefined ? undefined : dto.accountTitle?.trim() || null,
          accountNumber:
            dto.accountNumber === undefined ? undefined : dto.accountNumber?.trim() || null,
          branch: dto.branch === undefined ? undefined : dto.branch?.trim() || null,
          showToCustomers: dto.showToCustomers,
          active: dto.active,
        },
      });
      await this.audit.record(tx, {
        action: 'account.update',
        entityType: 'FinancialAccount',
        entityId: id,
        before: audited(this.accountDto(existing, true)),
        after: audited(this.accountDto(row, true)),
      });
      return this.accountDto(row, true);
    });
  }

  async listMethods(includeInactive = false): Promise<MethodDto[]> {
    const rows = await this.prisma.scoped.paymentMethod.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
    return rows.map(methodDto);
  }

  async createMethod(user: AuthUser, dto: CreateMethodDto): Promise<MethodDto> {
    await this.assertAccountUsable(dto.accountId);
    const name = dto.name.trim();
    if (await this.prisma.scoped.paymentMethod.findFirst({ where: { name } })) {
      throw new ValidationFailedException({ name: ['is already used by another payment method'] });
    }
    return this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.paymentMethod.create({
        data: {
          workspaceId: user.workspaceId,
          name,
          type: dto.type,
          accountId: dto.accountId,
          requiresReference: dto.requiresReference ?? false,
        },
      });
      await this.audit.record(tx, {
        action: 'payment_method.create',
        entityType: 'PaymentMethod',
        entityId: row.id,
        after: audited(methodDto(row)),
      });
      return methodDto(row);
    });
  }

  async updateMethod(id: string, dto: UpdateMethodDto): Promise<MethodDto> {
    const existing = await this.prisma.scoped.paymentMethod.findFirst({ where: { id } });
    if (!existing) throw new NotFoundAppException();
    if (dto.accountId !== undefined && dto.accountId !== existing.accountId) {
      await this.assertAccountUsable(dto.accountId);
    }
    const name = dto.name?.trim();
    if (name && name !== existing.name) {
      if (await this.prisma.scoped.paymentMethod.findFirst({ where: { name } })) {
        throw new ValidationFailedException({
          name: ['is already used by another payment method'],
        });
      }
    }
    return this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.paymentMethod.update({
        where: { id },
        data: {
          name,
          type: dto.type,
          accountId: dto.accountId,
          requiresReference: dto.requiresReference,
          active: dto.active,
        },
      });
      await this.audit.record(tx, {
        action: 'payment_method.update',
        entityType: 'PaymentMethod',
        entityId: id,
        before: audited(methodDto(existing)),
        after: audited(methodDto(row)),
      });
      return methodDto(row);
    });
  }

  private assertDetailsAllowed(
    type: string,
    dto: { bankName?: unknown; accountTitle?: unknown; accountNumber?: unknown; branch?: unknown },
  ): void {
    const sent = (['bankName', 'accountTitle', 'accountNumber', 'branch'] as const).filter(
      (k) => dto[k] !== undefined && dto[k] !== null && dto[k] !== '',
    );
    if (sent.length > 0 && !HAS_DETAILS.has(type)) {
      throw new ValidationFailedException(
        Object.fromEntries(
          sent.map((k) => [k, ['only bank accounts and wallets hold these details']]),
        ),
      );
    }
  }

  private async assertAccountNameFree(name: string): Promise<void> {
    if (await this.prisma.scoped.financialAccount.findFirst({ where: { name } })) {
      throw new ValidationFailedException({ name: ['is already used by another account'] });
    }
  }

  private async assertAccountUsable(accountId: string): Promise<void> {
    const account = await this.prisma.scoped.financialAccount.findFirst({
      where: { id: accountId, active: true },
    });
    if (!account) throw new ValidationFailedException({ accountId: ['is not an active account'] });
  }
}
