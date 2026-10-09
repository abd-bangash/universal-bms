import { Injectable } from '@nestjs/common';
import type { KnowledgeItem } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { NotFoundAppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateKnowledgeDto, UpdateKnowledgeDto } from './dto/ai.dto';

export interface KnowledgeDto {
  id: string;
  title: string;
  body: string;
  active: boolean;
  updatedAt: string;
}

const toDto = (k: KnowledgeItem): KnowledgeDto => ({
  id: k.id,
  title: k.title,
  body: k.body,
  active: k.active,
  updatedAt: k.updatedAt.toISOString(),
});

/** The business's approved answers and policies; only active ones are ever given to the AI (Requirement 43.7). */
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<KnowledgeDto[]> {
    const rows = await this.prisma.scoped.knowledgeItem.findMany({ orderBy: { title: 'asc' } });
    return rows.map(toDto);
  }

  async create(user: AuthUser, dto: CreateKnowledgeDto): Promise<KnowledgeDto> {
    const row = await this.prisma.scoped.$transaction(async (tx) => {
      const created = await tx.knowledgeItem.create({
        data: {
          workspaceId: user.workspaceId,
          title: dto.title.trim(),
          body: dto.body.trim(),
          active: dto.active ?? true,
        },
      });
      await this.audit.record(tx, {
        action: 'knowledge.create',
        entityType: 'KnowledgeItem',
        entityId: created.id,
        after: { title: created.title, active: created.active },
      });
      return created;
    });
    return toDto(row);
  }

  async update(id: string, dto: UpdateKnowledgeDto): Promise<KnowledgeDto> {
    const current = await this.prisma.scoped.knowledgeItem.findFirst({ where: { id } });
    if (!current) throw new NotFoundAppException();
    const row = await this.prisma.scoped.$transaction(async (tx) => {
      const updated = await tx.knowledgeItem.update({
        where: { id },
        data: {
          ...(dto.title === undefined ? {} : { title: dto.title.trim() }),
          ...(dto.body === undefined ? {} : { body: dto.body.trim() }),
          ...(dto.active === undefined ? {} : { active: dto.active }),
        },
      });
      await this.audit.record(tx, {
        action: 'knowledge.update',
        entityType: 'KnowledgeItem',
        entityId: id,
        before: { title: current.title, body: current.body, active: current.active },
        after: { title: updated.title, body: updated.body, active: updated.active },
      });
      return updated;
    });
    return toDto(row);
  }

  async remove(id: string): Promise<void> {
    const current = await this.prisma.scoped.knowledgeItem.findFirst({ where: { id } });
    if (!current) throw new NotFoundAppException();
    await this.prisma.scoped.$transaction(async (tx) => {
      await tx.knowledgeItem.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'knowledge.delete',
        entityType: 'KnowledgeItem',
        entityId: id,
        before: { title: current.title },
      });
    });
  }
}
