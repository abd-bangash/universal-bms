import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { NotFoundAppException, ValidationFailedException } from '../../common/errors/app.exception';
import { decodeCursor, toPage, type Page } from '../../common/pagination/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { Clock } from '../auth/clock';
import { MembershipCache } from '../auth/membership-cache';
import { TokenService } from '../auth/token.service';
import type { InviteUserDto, ListUsersQuery, UpdateUserDto } from './dto/users.dto';
import { elevatedRequired, lastOwnerError, ownerOnly } from './users.support';

const INVITATION_MS = 72 * 3600_000;

type MemberRow = Prisma.UserWorkspaceGetPayload<{
  include: {
    user: true;
    roles: { include: { role: { select: { id: true; name: true; isOwner: true } } } };
  };
}>;

export interface StaffDto {
  id: string;
  membershipId: string;
  email: string;
  firstName: string;
  lastName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING';
  phone: string | null;
  jobTitle: string | null;
  employeeCode: string | null;
  joinDate: string | null;
  isSalesperson: boolean;
  defaultLocationId: string | null;
  roles: Array<{ id: string; name: string }>;
}

const INCLUDE = {
  user: true,
  roles: { include: { role: { select: { id: true, name: true, isOwner: true } } } },
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly memberships: MembershipCache,
    private readonly clock: Clock,
  ) {}

  async list(query: ListUsersQuery): Promise<Page<StaffDto>> {
    const filters: Prisma.UserWorkspaceWhereInput[] = [];
    if (query.status) filters.push({ status: query.status });
    if (query.roleId) filters.push({ roles: { some: { roleId: query.roleId } } });
    if (query.q) {
      const text = { contains: query.q.trim(), mode: 'insensitive' as const };
      filters.push({ user: { OR: [{ firstName: text }, { lastName: text }, { email: text }] } });
    }
    if (query.cursor) {
      const { createdAt, id } = decodeCursor(query.cursor);
      if (
        typeof createdAt !== 'string' ||
        typeof id !== 'string' ||
        Number.isNaN(Date.parse(createdAt))
      ) {
        throw new ValidationFailedException({ cursor: ['is not a valid cursor'] });
      }
      const at = new Date(createdAt);
      filters.push({ OR: [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: id } }] });
    }
    const rows = await this.prisma.scoped.userWorkspace.findMany({
      where: { AND: filters },
      include: INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) => ({
      createdAt: last.createdAt.toISOString(),
      id: last.id,
    })).map(toStaffDto);
  }

  async get(userId: string): Promise<StaffDto> {
    return toStaffDto(await this.member(userId));
  }

  async update(actor: AuthUser, userId: string, dto: UpdateUserDto): Promise<StaffDto> {
    const member = await this.member(userId);
    const before = toStaffDto(member);

    if (dto.roleIds !== undefined && !actor.permissions.includes('role:configure')) {
      throw elevatedRequired('role:configure'); // changing roles changes permissions (Requirement 2.9)
    }
    const actorIsOwner = await this.isOwner(actor.membershipId);
    let newRoles: Array<{ id: string; isOwner: boolean }> | undefined;
    if (dto.roleIds !== undefined) {
      newRoles = await this.resolveRoles(dto.roleIds);
      if (newRoles.length === 0)
        throw new ValidationFailedException({ roleIds: ['at least one role is required'] });
      const touchesOwner =
        newRoles.some((r) => r.isOwner) !== member.roles.some((r) => r.role.isOwner);
      if (touchesOwner && !actorIsOwner) throw ownerOnly();
      if (member.roles.some((r) => r.role.isOwner) && !newRoles.some((r) => r.isOwner)) {
        await this.assertAnotherOwner(member.id);
      }
    }

    await this.prisma.scoped.$transaction(async (tx) => {
      if (dto.firstName !== undefined || dto.lastName !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { firstName: dto.firstName, lastName: dto.lastName },
        });
      }
      await tx.userWorkspace.update({
        where: { id: member.id },
        data: {
          phone: dto.phone,
          jobTitle: dto.jobTitle,
          employeeCode: dto.employeeCode,
          joinDate:
            dto.joinDate === undefined
              ? undefined
              : dto.joinDate === null
                ? null
                : new Date(dto.joinDate),
          isSalesperson: dto.isSalesperson,
          defaultLocationId: dto.defaultLocationId,
          ...(newRoles ? { permVersion: { increment: 1 } } : {}),
        },
      });
      if (newRoles) {
        await tx.userWorkspaceRole.deleteMany({ where: { userWorkspaceId: member.id } });
        await tx.userWorkspaceRole.createMany({
          data: newRoles.map((r) => ({
            workspaceId: actor.workspaceId,
            userWorkspaceId: member.id,
            roleId: r.id,
          })),
        });
      }
      const after = await tx.userWorkspace.findFirstOrThrow({
        where: { id: member.id },
        include: INCLUDE,
      });
      await this.audit.record(tx, {
        action: 'user.update',
        entityType: 'User',
        entityId: userId,
        before: before as unknown as Record<string, unknown>,
        after: toStaffDto(after) as unknown as Record<string, unknown>,
      });
    });
    if (newRoles) this.memberships.invalidate(member.id);
    return this.get(userId);
  }

  async invite(
    actor: AuthUser,
    dto: InviteUserDto,
  ): Promise<{ id: string; email: string; expiresAt: string; token: string }> {
    const email = dto.email.trim().toLowerCase();
    if (dto.roleIds.length === 0)
      throw new ValidationFailedException({ roleIds: ['at least one role is required'] });
    const roles = await this.resolveRoles(dto.roleIds);
    if (roles.some((r) => r.isOwner) && !(await this.isOwner(actor.membershipId)))
      throw ownerOnly();

    const existing = await this.prisma.scoped.userWorkspace.findFirst({
      where: { user: { email } },
    });
    if (existing)
      throw new ValidationFailedException({ email: ['is already a member of this workspace'] });

    const { token, hash } = this.tokens.newRefreshToken();
    const expiresAt = new Date(this.clock.now().getTime() + INVITATION_MS);
    const invitation = await this.prisma.scoped.$transaction(async (tx) => {
      await tx.invitation.deleteMany({ where: { email, acceptedAt: null } }); // a new invitation replaces an open one
      const created = await tx.invitation.create({
        data: {
          workspaceId: actor.workspaceId,
          email,
          roleIds: roles.map((r) => r.id),
          tokenHash: hash,
          expiresAt,
          invitedById: actor.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'user.invite',
        entityType: 'Invitation',
        entityId: created.id,
        after: { email, roleIds: created.roleIds, expiresAt },
      });
      return created;
    });
    // No email provider in Release 1: the token is shown once to the inviter, who shares the link.
    return { id: invitation.id, email, expiresAt: expiresAt.toISOString(), token };
  }

  async deactivate(actor: AuthUser, userId: string): Promise<StaffDto> {
    const member = await this.member(userId);
    if (member.status === 'INACTIVE') return toStaffDto(member);
    if (member.roles.some((r) => r.role.isOwner)) await this.assertAnotherOwner(member.id);

    await this.prisma.scoped.$transaction(async (tx) => {
      await tx.userWorkspace.update({
        where: { id: member.id },
        data: { status: 'INACTIVE', permVersion: { increment: 1 } },
      });
      await tx.userSession.updateMany({
        where: { userId, workspaceId: actor.workspaceId, revokedAt: null },
        data: { revokedAt: this.clock.now() },
      });
      await this.audit.record(tx, {
        action: 'user.deactivate',
        entityType: 'User',
        entityId: userId,
        before: { status: member.status },
        after: { status: 'INACTIVE' },
      });
    });
    this.memberships.invalidate(member.id);
    return this.get(userId);
  }

  async reactivate(_actor: AuthUser, userId: string): Promise<StaffDto> {
    const member = await this.member(userId);
    if (member.status === 'ACTIVE') return toStaffDto(member);
    await this.prisma.scoped.$transaction(async (tx) => {
      await tx.userWorkspace.update({
        where: { id: member.id },
        data: { status: 'ACTIVE', permVersion: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'user.reactivate',
        entityType: 'User',
        entityId: userId,
        before: { status: member.status },
        after: { status: 'ACTIVE' },
      });
    });
    this.memberships.invalidate(member.id);
    return this.get(userId);
  }

  /** One-time reset link for a colleague when no email provider is configured (Requirement 45.3). */
  async createResetLink(
    actor: AuthUser,
    userId: string,
  ): Promise<{ token: string; expiresAt: string }> {
    const member = await this.member(userId);
    if (member.roles.some((r) => r.role.isOwner) && !(await this.isOwner(actor.membershipId)))
      throw ownerOnly();
    if (member.user.status !== 'ACTIVE') {
      throw new ValidationFailedException({ user: ['the account is not active'] });
    }
    const token = await this.auth.createResetToken(userId);
    await this.audit.recordAsync({
      action: 'user.reset_link_created',
      entityType: 'User',
      entityId: userId,
    });
    return { token, expiresAt: new Date(this.clock.now().getTime() + 60 * 60_000).toISOString() };
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async member(userId: string): Promise<MemberRow> {
    const row = await this.prisma.scoped.userWorkspace.findFirst({
      where: { userId },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundAppException();
    return row;
  }

  private async resolveRoles(roleIds: string[]): Promise<Array<{ id: string; isOwner: boolean }>> {
    const unique = [...new Set(roleIds)];
    const roles = await this.prisma.scoped.role.findMany({
      where: { id: { in: unique } },
      select: { id: true, isOwner: true },
    });
    if (roles.length !== unique.length) {
      throw new ValidationFailedException({ roleIds: ['contains a role that does not exist'] });
    }
    return roles;
  }

  private async isOwner(membershipId: string): Promise<boolean> {
    const count = await this.prisma.scoped.userWorkspaceRole.count({
      where: { userWorkspaceId: membershipId, role: { isOwner: true } },
    });
    return count > 0;
  }

  /** Throws unless some other active member also holds an Owner role. */
  private async assertAnotherOwner(excludingMembershipId: string): Promise<void> {
    const others = await this.prisma.scoped.userWorkspace.count({
      where: {
        id: { not: excludingMembershipId },
        status: 'ACTIVE',
        roles: { some: { role: { isOwner: true } } },
      },
    });
    if (others === 0) throw lastOwnerError('userId');
  }
}

export function toStaffDto(row: MemberRow): StaffDto {
  return {
    id: row.userId,
    membershipId: row.id,
    email: row.user.email,
    firstName: row.user.firstName,
    lastName: row.user.lastName,
    status: row.status,
    phone: row.phone,
    jobTitle: row.jobTitle,
    employeeCode: row.employeeCode,
    joinDate: row.joinDate ? row.joinDate.toISOString() : null,
    isSalesperson: row.isSalesperson,
    defaultLocationId: row.defaultLocationId,
    roles: row.roles
      .map((r) => ({ id: r.role.id, name: r.role.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
