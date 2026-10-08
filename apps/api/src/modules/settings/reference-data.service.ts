import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { NotFoundAppException, ValidationFailedException } from '../../common/errors/app.exception';
import { D, toDecimal, toJsonString } from '../../common/money';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type {
  CreateTaxClassDto,
  CreateUnitDto,
  UpdateTaxClassDto,
  UpdateUnitDto,
} from './dto/settings.dto';

export interface UnitDto {
  id: string;
  name: string;
  symbol: string;
  dimension: string;
  toBase: string;
}
export interface TaxClassDto {
  id: string;
  name: string;
  rate: string;
  active: boolean;
}

const unitDto = (u: {
  id: string;
  name: string;
  symbol: string;
  dimension: string;
  toBase: { toFixed(): string };
}): UnitDto => ({
  id: u.id,
  name: u.name,
  symbol: u.symbol,
  dimension: u.dimension,
  toBase: u.toBase.toFixed(),
});
const taxDto = (t: {
  id: string;
  name: string;
  rate: { toFixed(): string };
  active: boolean;
}): TaxClassDto => ({
  id: t.id,
  name: t.name,
  rate: t.rate.toFixed(),
  active: t.active,
});

/** Units (with their conversion factors) and tax classes: workspace reference data. */
@Injectable()
export class ReferenceDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Units (Requirements 28.4, 28.5) ──────────────────────────────────────

  async listUnits(): Promise<UnitDto[]> {
    const rows = await this.prisma.scoped.unit.findMany({
      orderBy: [{ dimension: 'asc' }, { toBase: 'desc' }, { name: 'asc' }],
    });
    return rows.map(unitDto);
  }

  async createUnit(actor: AuthUser, dto: CreateUnitDto): Promise<UnitDto> {
    const toBase = this.positiveFactor(dto.toBase);
    await this.assertSymbolFree(dto.symbol);
    return this.write(async (tx) => {
      const unit = await tx.unit.create({
        data: {
          workspaceId: actor.workspaceId,
          name: dto.name.trim(),
          symbol: dto.symbol.trim(),
          dimension: dto.dimension,
          toBase,
        },
      });
      await this.audit.record(tx, {
        action: 'unit.create',
        entityType: 'Unit',
        entityId: unit.id,
        after: unitDto(unit) as unknown as Record<string, unknown>,
      });
      return unitDto(unit);
    });
  }

  /** Only the name and symbol can change: the factor and dimension would silently change stock quantities. */
  async updateUnit(id: string, dto: UpdateUnitDto): Promise<UnitDto> {
    const existing = await this.prisma.scoped.unit.findFirst({ where: { id } });
    if (!existing) throw new NotFoundAppException();
    if (dto.symbol !== undefined && dto.symbol.trim() !== existing.symbol)
      await this.assertSymbolFree(dto.symbol, id);
    return this.write(async (tx) => {
      const unit = await tx.unit.update({
        where: { id },
        data: { name: dto.name?.trim(), symbol: dto.symbol?.trim() },
      });
      await this.audit.record(tx, {
        action: 'unit.update',
        entityType: 'Unit',
        entityId: id,
        before: unitDto(existing) as unknown as Record<string, unknown>,
        after: unitDto(unit) as unknown as Record<string, unknown>,
      });
      return unitDto(unit);
    });
  }

  // ── Tax classes ──────────────────────────────────────────────────────────

  async listTaxClasses(): Promise<TaxClassDto[]> {
    return (await this.prisma.scoped.taxClass.findMany({ orderBy: { name: 'asc' } })).map(taxDto);
  }

  async createTaxClass(actor: AuthUser, dto: CreateTaxClassDto): Promise<TaxClassDto> {
    const rate = this.rate(dto.rate);
    await this.assertTaxNameFree(dto.name);
    return this.write(async (tx) => {
      const tax = await tx.taxClass.create({
        data: {
          workspaceId: actor.workspaceId,
          name: dto.name.trim(),
          rate,
          active: dto.active ?? true,
        },
      });
      await this.audit.record(tx, {
        action: 'tax_class.create',
        entityType: 'TaxClass',
        entityId: tax.id,
        after: taxDto(tax) as unknown as Record<string, unknown>,
      });
      return taxDto(tax);
    });
  }

  async updateTaxClass(id: string, dto: UpdateTaxClassDto): Promise<TaxClassDto> {
    const existing = await this.prisma.scoped.taxClass.findFirst({ where: { id } });
    if (!existing) throw new NotFoundAppException();
    if (dto.name !== undefined && dto.name.trim() !== existing.name)
      await this.assertTaxNameFree(dto.name, id);
    return this.write(async (tx) => {
      const tax = await tx.taxClass.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          rate: dto.rate === undefined ? undefined : this.rate(dto.rate),
          active: dto.active,
        },
      });
      await this.audit.record(tx, {
        action: 'tax_class.update',
        entityType: 'TaxClass',
        entityId: id,
        before: taxDto(existing) as unknown as Record<string, unknown>,
        after: taxDto(tax) as unknown as Record<string, unknown>,
      });
      return taxDto(tax);
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private write<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.scoped.$transaction((tx) => work(tx as unknown as Prisma.TransactionClient));
  }

  private positiveFactor(value: string): string {
    const factor = toDecimal(value);
    if (factor.lte(0) || factor.decimalPlaces() > 8 || factor.gte(new D('1e10'))) {
      throw new ValidationFailedException({
        toBase: ['must be greater than 0, with at most 8 decimals'],
      });
    }
    return toJsonString(factor);
  }

  /** A tax rate is a fraction between 0 and 1 with at most 4 decimals. */
  private rate(value: string): string {
    const rate = toDecimal(value);
    if (rate.lt(0) || rate.gt(1) || rate.decimalPlaces() > 4) {
      throw new ValidationFailedException({
        rate: ['must be a fraction between 0 and 1 with at most 4 decimals, such as 0.1700'],
      });
    }
    return toJsonString(rate);
  }

  private async assertSymbolFree(symbol: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.scoped.unit.findFirst({
      where: { symbol: symbol.trim(), ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    });
    if (clash)
      throw new ValidationFailedException({ symbol: ['a unit with this symbol already exists'] });
  }

  private async assertTaxNameFree(name: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.scoped.taxClass.findFirst({
      where: {
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
    });
    if (clash)
      throw new ValidationFailedException({ name: ['a tax class with this name already exists'] });
  }
}
