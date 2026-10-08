import { Injectable } from '@nestjs/common';
import { PERMISSION_CATALOGUE, WORKSPACE_PERMISSIONS, isPermission } from '@bms/types';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MembershipCache } from '../auth/membership-cache';
import type { CreateRoleDto, UpdateRoleDto } from './dto/roles.dto';

const OWNER_IMMUTABLE = () =>
  new AppException('PERMISSION_DENIED', 403, 'The Owner role cannot be changed');

export interface RoleDto {
  id: string;
  name: string;
  isSystem: boolean;
  isOwner: boolean;
  permissions: string[];
  maxDiscountPercent: string;
  viewerModules: string[];
  memberCount: number;
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly memberships: MembershipCache,
  ) {}

  /** The permission catalogue as shown in the role editor (platform-only permissions are not grantable). */
  catalogue() {
    return {
      resources: Object.entries(PERMISSION_CATALOGUE)
        .filter(([resource]) => resource !== 'platform')
        .map(([resource, actions]) => ({
          resource,
          actions: [...actions],
          permissions: actions.map((a) => `${resource}:${a}`),
        })),
      permissions: [...WORKSPACE_PERMISSIONS],
    };
  }

  async list(): Promise<RoleDto[]> {
    const roles = await this.prisma.scoped.role.findMany({
      orderBy: [{ isOwner: 'desc' }, { isSystem: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { members: true } } },
    });
    return roles.map((r) => this.toDto(r, r._count.members));
  }

  async create(user: AuthUser, dto: CreateRoleDto): Promise<RoleDto> {
    const permissions = this.validPermissions(dto.permissions);
    await this.assertNameFree(dto.name);
    const role = await this.prisma.scoped.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          workspaceId: user.workspaceId,
          name: dto.name.trim(),
          permissions,
          maxDiscountPercent: dto.maxDiscountPercent ?? 0,
          viewerModules: dto.viewerModules ?? [],
        },
      });
      await this.audit.record(tx, {
        action: 'role.create',
        entityType: 'Role',
        entityId: created.id,
        after: {
          name: created.name,
          permissions: created.permissions,
          maxDiscountPercent: created.maxDiscountPercent,
        },
      });
      return created;
    });
    return this.toDto(role, 0);
  }

  async update(user: AuthUser, id: string, dto: UpdateRoleDto): Promise<RoleDto> {
    const existing = await this.prisma.scoped.role.findFirst({ where: { id } });
    if (!existing) throw new NotFoundAppException();
    if (existing.isOwner) throw OWNER_IMMUTABLE();

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined && dto.name.trim() !== existing.name) {
      await this.assertNameFree(dto.name, id);
      data.name = dto.name.trim();
    }
    if (dto.permissions !== undefined) data.permissions = this.validPermissions(dto.permissions);
    if (dto.maxDiscountPercent !== undefined) data.maxDiscountPercent = dto.maxDiscountPercent;
    if (dto.viewerModules !== undefined) data.viewerModules = dto.viewerModules;

    const { updated, memberCount } = await this.prisma.scoped.$transaction(async (tx) => {
      const updated = await tx.role.update({ where: { id }, data });
      const permissionsChanged =
        dto.permissions !== undefined &&
        JSON.stringify([...existing.permissions].sort()) !==
          JSON.stringify([...updated.permissions].sort());
      const affected = await tx.userWorkspaceRole.findMany({
        where: { roleId: id },
        select: { userWorkspaceId: true },
      });
      if (permissionsChanged || data.maxDiscountPercent !== undefined) {
        await this.bumpPermVersions(
          tx,
          affected.map((a) => a.userWorkspaceId),
        );
      }
      await this.audit.record(tx, {
        action: 'role.update',
        entityType: 'Role',
        entityId: id,
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
      });
      return { updated, memberCount: affected.length };
    });
    this.memberships.invalidate();
    return this.toDto(updated, memberCount);
  }

  /** Deletes a custom role; everyone holding it moves to the fallback role (Requirement 3.4). */
  async remove(user: AuthUser, id: string, fallbackRoleId: string): Promise<void> {
    const role = await this.prisma.scoped.role.findFirst({ where: { id } });
    if (!role) throw new NotFoundAppException();
    if (role.isOwner) throw OWNER_IMMUTABLE();
    if (role.isSystem)
      throw new AppException('PERMISSION_DENIED', 403, 'System roles cannot be deleted');
    if (fallbackRoleId === id) {
      throw new ValidationFailedException({ fallbackRoleId: ['must be a different role'] });
    }
    const fallback = await this.prisma.scoped.role.findFirst({ where: { id: fallbackRoleId } });
    if (!fallback) throw new ValidationFailedException({ fallbackRoleId: ['role not found'] });
    if (fallback.isOwner)
      throw new ValidationFailedException({ fallbackRoleId: ['cannot be the Owner role'] });

    await this.prisma.scoped.$transaction(async (tx) => {
      const holders = await tx.userWorkspaceRole.findMany({
        where: { roleId: id },
        select: { userWorkspaceId: true },
      });
      const ids = holders.map((h) => h.userWorkspaceId);
      const alreadyFallback = await tx.userWorkspaceRole.findMany({
        where: { roleId: fallbackRoleId, userWorkspaceId: { in: ids } },
        select: { userWorkspaceId: true },
      });
      const have = new Set(alreadyFallback.map((a) => a.userWorkspaceId));
      const toAdd = ids.filter((m) => !have.has(m));
      if (toAdd.length > 0) {
        await tx.userWorkspaceRole.createMany({
          data: toAdd.map((userWorkspaceId) => ({
            workspaceId: user.workspaceId,
            userWorkspaceId,
            roleId: fallbackRoleId,
          })),
        });
      }
      await tx.userWorkspaceRole.deleteMany({ where: { roleId: id } });
      await tx.role.delete({ where: { id } });
      await this.bumpPermVersions(tx, ids);
      await this.audit.record(tx, {
        action: 'role.delete',
        entityType: 'Role',
        entityId: id,
        before: { name: role.name, permissions: role.permissions },
        metadata: { fallbackRoleId, reassignedMembers: ids.length },
      });
    });
    this.memberships.invalidate();
  }

  private async bumpPermVersions(
    tx: {
      userWorkspace: {
        updateMany(args: {
          where: { id: { in: string[] } };
          data: { permVersion: { increment: number } };
        }): PromiseLike<unknown>;
      };
    },
    membershipIds: string[],
  ): Promise<void> {
    if (membershipIds.length === 0) return;
    await tx.userWorkspace.updateMany({
      where: { id: { in: membershipIds } },
      data: { permVersion: { increment: 1 } },
    });
  }

  private validPermissions(input: string[]): string[] {
    const invalid = input.filter((p) => !isPermission(p) || p === 'platform:admin');
    if (invalid.length > 0) {
      throw new ValidationFailedException({
        permissions: [`unknown or not grantable: ${invalid.join(', ')}`],
      });
    }
    return [...new Set(input)].sort();
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.scoped.role.findFirst({
      where: {
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
    });
    if (clash)
      throw new ValidationFailedException({ name: ['a role with this name already exists'] });
  }

  private toDto(
    r: {
      id: string;
      name: string;
      isSystem: boolean;
      isOwner: boolean;
      permissions: string[];
      maxDiscountPercent: { toFixed(): string };
      viewerModules: string[];
    },
    memberCount: number,
  ): RoleDto {
    return {
      id: r.id,
      name: r.name,
      isSystem: r.isSystem,
      isOwner: r.isOwner,
      permissions: r.isOwner ? [...WORKSPACE_PERMISSIONS] : r.permissions,
      maxDiscountPercent: r.maxDiscountPercent.toFixed(),
      viewerModules: r.viewerModules,
      memberCount,
    };
  }
}
