import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { AppException, NotFoundAppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toBrandDto, type BrandDto } from './catalog.support';
import type { CreateBrandDto, UpdateBrandDto } from './dto/catalog.dto';

const DUPLICATE = () =>
  new AppException('POSSIBLE_DUPLICATE', 409, 'A brand with this name already exists', {
    name: ['already exists'],
  });

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false): Promise<BrandDto[]> {
    const rows = await this.prisma.scoped.brand.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
    return rows.map(toBrandDto);
  }

  async create(actor: AuthUser, dto: CreateBrandDto): Promise<BrandDto> {
    await this.assertNameFree(dto.name.trim());
    const row = await this.prisma.scoped.$transaction(async (tx) => {
      const created = await tx.brand.create({
        data: { workspaceId: actor.workspaceId, name: dto.name.trim() },
      });
      await this.audit.record(tx, {
        action: 'brand.create',
        entityType: 'Brand',
        entityId: created.id,
        after: toBrandDto(created) as unknown as Record<string, unknown>,
      });
      return created;
    });
    return toBrandDto(row);
  }

  async update(id: string, dto: UpdateBrandDto): Promise<BrandDto> {
    const existing = await this.prisma.scoped.brand.findFirst({ where: { id } });
    if (!existing) throw new NotFoundAppException();
    if (dto.name !== undefined) await this.assertNameFree(dto.name.trim(), id);
    const row = await this.prisma.scoped.$transaction(async (tx) => {
      const updated = await tx.brand.update({
        where: { id },
        data: { name: dto.name?.trim(), active: dto.active },
      });
      await this.audit.record(tx, {
        action: 'brand.update',
        entityType: 'Brand',
        entityId: id,
        before: toBrandDto(existing) as unknown as Record<string, unknown>,
        after: toBrandDto(updated) as unknown as Record<string, unknown>,
      });
      return updated;
    });
    return toBrandDto(row);
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.scoped.brand.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (clash) throw DUPLICATE();
  }
}
