import { Injectable } from '@nestjs/common';
import type { Category } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { AppException, NotFoundAppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  toCategoryDto,
  requireDetails,
  type CategoryDto,
  type CategoryNode,
} from './catalog.support';
import type { CreateCategoryDto, UpdateCategoryDto } from './dto/catalog.dto';

const MAX_DEPTH = 5;
const DUPLICATE = () =>
  new AppException('POSSIBLE_DUPLICATE', 409, 'A category with this name already exists here', {
    name: ['already exists in this place'],
  });

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The whole tree, ordered by sort order then name. Inactive ones only when asked for. */
  async tree(includeInactive = false): Promise<CategoryNode[]> {
    const rows = await this.prisma.scoped.category.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const nodes = new Map<string, CategoryNode>(
      rows.map((r) => [r.id, { ...toCategoryDto(r), children: [] }]),
    );
    const roots: CategoryNode[] = [];
    for (const node of nodes.values()) {
      if (!node.parentId) roots.push(node);
      // A category below a deactivated one goes with it.
      else nodes.get(node.parentId)?.children.push(node);
    }
    return roots;
  }

  async create(actor: AuthUser, dto: CreateCategoryDto): Promise<CategoryDto> {
    const parentId = dto.parentId ?? null;
    if (parentId) await this.assertDepth(parentId);
    await this.assertNameFree(dto.name.trim(), parentId);
    const created = await this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.category.create({
        data: {
          workspaceId: actor.workspaceId,
          name: dto.name.trim(),
          parentId,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      await this.audit.record(tx, {
        action: 'category.create',
        entityType: 'Category',
        entityId: row.id,
        after: toCategoryDto(row) as unknown as Record<string, unknown>,
      });
      return row;
    });
    return toCategoryDto(created);
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<CategoryDto> {
    const existing = await this.get(id);
    const parentId = dto.parentId === undefined ? existing.parentId : dto.parentId;
    const name = dto.name?.trim() ?? existing.name;

    if (parentId !== existing.parentId && parentId) {
      const below = await this.descendantIds(id);
      if (parentId === id || below.includes(parentId)) {
        requireDetails({
          parentId: ['cannot be the category itself or one of its sub-categories'],
        });
      }
      await this.assertDepth(parentId, 1 + (await this.height(id)));
    }
    if (name !== existing.name || parentId !== existing.parentId) {
      await this.assertNameFree(name, parentId, id);
    }

    const updated = await this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.category.update({
        where: { id },
        data: { name, parentId, sortOrder: dto.sortOrder, active: dto.active },
      });
      await this.audit.record(tx, {
        action: 'category.update',
        entityType: 'Category',
        entityId: id,
        before: toCategoryDto(existing) as unknown as Record<string, unknown>,
        after: toCategoryDto(row) as unknown as Record<string, unknown>,
      });
      return row;
    });
    return toCategoryDto(updated);
  }

  async get(id: string): Promise<Category> {
    const row = await this.prisma.scoped.category.findFirst({ where: { id } });
    if (!row) throw new NotFoundAppException();
    return row;
  }

  /** Ids of every category below `id` (not including it). */
  async descendantIds(id: string): Promise<string[]> {
    const all = await this.prisma.scoped.category.findMany({
      select: { id: true, parentId: true },
    });
    const children = new Map<string, string[]>();
    for (const c of all)
      if (c.parentId) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c.id]);
    const out: string[] = [];
    const stack = [...(children.get(id) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      out.push(next);
      stack.push(...(children.get(next) ?? []));
    }
    return out;
  }

  /** Ids of the ancestors of `id`, nearest first (for category-scoped custom fields). */
  async ancestorIds(id: string | null | undefined): Promise<string[]> {
    if (!id) return [];
    const all = await this.prisma.scoped.category.findMany({
      select: { id: true, parentId: true },
    });
    const parentOf = new Map(all.map((c) => [c.id, c.parentId]));
    const out: string[] = [];
    let cursor = parentOf.get(id) ?? null;
    while (cursor && !out.includes(cursor)) {
      out.push(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
    return out;
  }

  private async depthOf(id: string): Promise<number> {
    return (await this.ancestorIds(id)).length + 1;
  }

  private async height(id: string): Promise<number> {
    const all = await this.prisma.scoped.category.findMany({
      select: { id: true, parentId: true },
    });
    const walk = (node: string): number =>
      1 + Math.max(0, ...all.filter((c) => c.parentId === node).map((c) => walk(c.id)));
    return walk(id) - 1;
  }

  private async assertDepth(parentId: string, extraBelow = 0): Promise<void> {
    await this.get(parentId); // 404 for a parent in another workspace
    if ((await this.depthOf(parentId)) + 1 + extraBelow > MAX_DEPTH) {
      requireDetails({ parentId: [`categories can be nested at most ${MAX_DEPTH} levels deep`] });
    }
  }

  private async assertNameFree(name: string, parentId: string | null, exceptId?: string) {
    const clash = await this.prisma.scoped.category.findFirst({
      where: {
        parentId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (clash) throw DUPLICATE();
  }
}
