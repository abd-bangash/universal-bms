import { Injectable } from '@nestjs/common';
import type { LoginResult, TokenPair } from '@bms/types';
import { WORKSPACE_PERMISSIONS, isPermission } from '@bms/types';
import { ClsService } from 'nestjs-cls';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import type { RequestContext } from '../../common/context/request-context';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Clock } from './clock';
import { MembershipCache } from './membership-cache';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_WINDOW_MS = 15 * 60_000;
const RESET_TOKEN_MS = 60 * 60_000;
const PLATFORM_ONLY = new Set(['platform:admin']);

const INVALID_CREDENTIALS = () =>
  new AppException('INVALID_CREDENTIALS', 401, 'The email or password is incorrect');
const REFRESH_REJECTED = () => new AppException('UNAUTHENTICATED', 401, 'Sign in again');

interface MembershipRow {
  id: string;
  workspaceId: string;
  permVersion: number;
  workspace: { id: string; name: string };
  roles: Array<{ role: { name: string; permissions: string[]; isOwner: boolean } }>;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly cls: ClsService<RequestContext>,
    private readonly clock: Clock,
    private readonly memberships: MembershipCache,
  ) {}

  // ── Login ────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<LoginResult> {
    const normalized = email.trim().toLowerCase();
    const now = this.clock.now();
    const user = await this.prisma.unscoped.user.findUnique({ where: { email: normalized } });

    if (user?.lockedUntil && user.lockedUntil > now) {
      await this.recordLoginAttempt(normalized, false);
      throw new AppException('ACCOUNT_LOCKED', 401, 'Too many failed attempts. Try again later.');
    }

    const valid = user?.passwordHash
      ? await this.passwords.verify(user.passwordHash, password)
      : false;
    if (!user?.passwordHash) await this.passwords.verifyDummy(password);

    if (!user || !valid || user.status !== 'ACTIVE') {
      await this.handleFailedLogin(normalized, user?.id);
      throw INVALID_CREDENTIALS();
    }

    await this.recordLoginAttempt(normalized, true);
    if (user.lockedUntil) {
      await this.prisma.unscoped.user.update({
        where: { id: user.id },
        data: { lockedUntil: null },
      });
    }

    const memberships = await this.activeMemberships(user.id);
    if (memberships.length === 0) {
      throw new AppException('PERMISSION_DENIED', 403, 'This account has no active workspace');
    }
    if (memberships.length > 1) {
      return {
        requiresWorkspaceSelection: true,
        loginTicket: this.tokens.signLoginTicket(user.id),
        workspaces: memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name })),
      };
    }
    const pair = await this.startSession(user.id, memberships[0] as MembershipRow);
    return { requiresWorkspaceSelection: false, ...pair };
  }

  async selectWorkspace(loginTicket: string, workspaceId: string): Promise<TokenPair> {
    const ticket = this.tokens.verifyLoginTicket(loginTicket);
    if (!ticket)
      throw new AppException('UNAUTHENTICATED', 401, 'The login ticket is invalid or expired');
    const membership = (await this.activeMemberships(ticket.sub)).find(
      (m) => m.workspaceId === workspaceId,
    );
    if (!membership)
      throw new AppException('PERMISSION_DENIED', 403, 'You do not have access to that workspace');
    return this.startSession(ticket.sub, membership);
  }

  async switchWorkspace(user: AuthUser, workspaceId: string): Promise<TokenPair> {
    const membership = (await this.activeMemberships(user.userId)).find(
      (m) => m.workspaceId === workspaceId,
    );
    if (!membership)
      throw new AppException('PERMISSION_DENIED', 403, 'You do not have access to that workspace');
    return this.startSession(user.userId, membership);
  }

  // ── Refresh, logout, sessions ────────────────────────────────────────────

  async refresh(refreshToken: string): Promise<TokenPair> {
    const now = this.clock.now();
    const session = await this.prisma.unscoped.userSession.findUnique({
      where: { refreshTokenHash: TokenService.hash(refreshToken) },
    });
    if (!session) throw REFRESH_REJECTED();

    if (session.revokedAt || session.expiresAt <= now) throw REFRESH_REJECTED();

    // Claim the token atomically; losing the claim means it was already rotated.
    const claimed = await this.prisma.unscoped.userSession.updateMany({
      where: { id: session.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: now },
    });
    if (claimed.count === 0) {
      await this.revokeFamily(session.familyId);
      if (session.workspaceId) {
        await this.audit.recordAsync({
          workspaceId: session.workspaceId,
          action: 'auth.refresh_token_reuse',
          entityType: 'User',
          entityId: session.userId,
          actor: { userId: session.userId },
          metadata: { familyId: session.familyId },
        });
      }
      throw REFRESH_REJECTED();
    }

    const membership = session.workspaceId
      ? (await this.activeMemberships(session.userId)).find(
          (m) => m.workspaceId === session.workspaceId,
        )
      : undefined;
    if (!membership) {
      await this.revokeFamily(session.familyId);
      throw REFRESH_REJECTED();
    }
    return this.startSession(session.userId, membership, session.familyId);
  }

  async logout(user: AuthUser): Promise<void> {
    await this.revokeFamily(user.familyId);
    await this.audit.recordAsync({
      workspaceId: user.workspaceId,
      action: 'auth.logout',
      entityType: 'User',
      entityId: user.userId,
      actor: { userId: user.userId },
    });
  }

  async listSessions(user: AuthUser) {
    const now = this.clock.now();
    const rows = await this.prisma.unscoped.userSession.findMany({
      where: { userId: user.userId, revokedAt: null, rotatedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    const workspaces = await this.prisma.unscoped.workspace.findMany({
      where: { id: { in: rows.flatMap((r) => (r.workspaceId ? [r.workspaceId] : [])) } },
      select: { id: true, name: true },
    });
    const names = new Map(workspaces.map((w) => [w.id, w.name]));
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceId ? (names.get(r.workspaceId) ?? null) : null,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      isCurrent: r.familyId === user.familyId,
    }));
  }

  async revokeSession(user: AuthUser, sessionId: string): Promise<void> {
    const session = await this.prisma.unscoped.userSession.findFirst({
      where: { id: sessionId, userId: user.userId },
    });
    if (!session) throw new NotFoundAppException();
    await this.revokeFamily(session.familyId);
    await this.audit.recordAsync({
      workspaceId: user.workspaceId,
      action: 'auth.session_revoked',
      entityType: 'User',
      entityId: user.userId,
      actor: { userId: user.userId },
      metadata: { sessionId },
    });
  }

  // ── Passwords ────────────────────────────────────────────────────────────

  async changePassword(
    user: AuthUser,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const record = await this.prisma.unscoped.user.findUniqueOrThrow({
      where: { id: user.userId },
    });
    if (
      !record.passwordHash ||
      !(await this.passwords.verify(record.passwordHash, currentPassword))
    ) {
      throw new ValidationFailedException({ currentPassword: ['is incorrect'] });
    }
    this.passwords.assertPolicy(newPassword, record.email);
    await this.prisma.unscoped.user.update({
      where: { id: record.id },
      data: { passwordHash: await this.passwords.hash(newPassword) },
    });
    await this.prisma.unscoped.userSession.updateMany({
      where: { userId: record.id, familyId: { not: user.familyId }, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
    await this.audit.recordAsync({
      workspaceId: user.workspaceId,
      action: 'auth.password_changed',
      entityType: 'User',
      entityId: record.id,
      actor: { userId: record.id },
    });
  }

  /** Creates a single-use reset token valid for 60 minutes. Used by "forgot" and the admin reset link. */
  async createResetToken(userId: string): Promise<string> {
    const { token, hash } = this.tokens.newRefreshToken();
    await this.prisma.unscoped.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hash,
        expiresAt: new Date(this.clock.now().getTime() + RESET_TOKEN_MS),
      },
    });
    return token;
  }

  /**
   * Requirement 45.2: same response whether or not the account exists. With no email adapter in R1
   * the token is not delivered; staff hand out an admin reset link instead (task 10).
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.unscoped.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (user?.status === 'ACTIVE') {
      await this.createResetToken(user.id);
      await this.auditForUserWorkspaces(user.id, 'auth.password_reset_requested');
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const now = this.clock.now();
    const record = await this.prisma.unscoped.passwordResetToken.findUnique({
      where: { tokenHash: TokenService.hash(token) },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt <= now) {
      throw new ValidationFailedException({ token: ['is invalid or has expired'] });
    }
    this.passwords.assertPolicy(newPassword, record.user.email);
    const claimed = await this.prisma.unscoped.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count === 0)
      throw new ValidationFailedException({ token: ['is invalid or has expired'] });

    await this.prisma.unscoped.user.update({
      where: { id: record.userId },
      data: { passwordHash: await this.passwords.hash(newPassword), lockedUntil: null },
    });
    await this.prisma.unscoped.userSession.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await this.auditForUserWorkspaces(record.userId, 'auth.password_reset');
  }

  // ── Invitations ──────────────────────────────────────────────────────────

  /**
   * Accepts an invitation: creates the account (or, for someone who already has one, confirms their
   * password) and the membership with the invited roles. Public route, so it runs before any
   * workspace is known.
   */
  async acceptInvitation(dto: {
    token: string;
    password: string;
    firstName: string;
    lastName: string;
  }): Promise<{ workspaceId: string }> {
    const now = this.clock.now();
    const bad = () => new ValidationFailedException({ token: ['is invalid or has expired'] });
    const invitation = await this.prisma.unscoped.invitation.findUnique({
      where: { tokenHash: TokenService.hash(dto.token) },
      include: { workspace: { select: { status: true } } },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.expiresAt <= now ||
      invitation.workspace.status !== 'ACTIVE'
    )
      throw bad();

    const existing = await this.prisma.unscoped.user.findUnique({
      where: { email: invitation.email.toLowerCase() },
    });
    if (existing) {
      if (
        existing.status !== 'ACTIVE' ||
        !existing.passwordHash ||
        !(await this.passwords.verify(existing.passwordHash, dto.password))
      ) {
        throw new ValidationFailedException({ password: ['does not match the existing account'] });
      }
    } else {
      this.passwords.assertPolicy(dto.password, invitation.email);
    }
    const passwordHash = existing ? undefined : await this.passwords.hash(dto.password);

    return this.prisma.unscoped.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null },
        data: { acceptedAt: now },
      });
      if (claimed.count === 0) throw bad();

      const user =
        existing ??
        (await tx.user.create({
          data: {
            email: invitation.email.toLowerCase(),
            firstName: dto.firstName,
            lastName: dto.lastName,
            status: 'ACTIVE',
            passwordHash,
          },
        }));
      const already = await tx.userWorkspace.findUnique({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } },
      });
      if (already?.status === 'ACTIVE')
        throw new ValidationFailedException({ token: ['this account is already a member'] });

      const roles = await tx.role.findMany({
        where: { workspaceId: invitation.workspaceId, id: { in: invitation.roleIds } },
        select: { id: true },
      });
      if (roles.length === 0) throw bad();
      const membership = already
        ? await tx.userWorkspace.update({
            where: { id: already.id },
            data: { status: 'ACTIVE', permVersion: { increment: 1 } },
          })
        : await tx.userWorkspace.create({
            data: { workspaceId: invitation.workspaceId, userId: user.id },
          });
      await tx.userWorkspaceRole.deleteMany({ where: { userWorkspaceId: membership.id } });
      await tx.userWorkspaceRole.createMany({
        data: roles.map((r) => ({
          workspaceId: invitation.workspaceId,
          userWorkspaceId: membership.id,
          roleId: r.id,
        })),
      });
      await this.audit.record(tx, {
        workspaceId: invitation.workspaceId,
        action: 'user.invitation_accepted',
        entityType: 'User',
        entityId: user.id,
        actor: { userId: user.id },
        after: { email: invitation.email, roleIds: roles.map((r) => r.id) },
      });
      return { workspaceId: invitation.workspaceId };
    });
  }

  // ── Profile ──────────────────────────────────────────────────────────────

  async me(user: AuthUser) {
    const membership = await this.prisma.unscoped.userWorkspace.findUniqueOrThrow({
      where: { id: user.membershipId },
      include: {
        user: true,
        workspace: true,
        roles: { include: { role: { select: { name: true } } } },
      },
    });
    const config = (membership.workspace.config ?? {}) as {
      terminology?: unknown;
      modules?: unknown;
    };
    return {
      user: {
        id: membership.user.id,
        email: membership.user.email,
        firstName: membership.user.firstName,
        lastName: membership.user.lastName,
      },
      workspace: {
        id: membership.workspace.id,
        name: membership.workspace.name,
        industryProfile: membership.workspace.industryProfile,
      },
      roles: membership.roles.map((r) => r.role.name),
      permissions: user.permissions,
      terminology: config.terminology ?? {},
      modules: config.modules ?? {},
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async activeMemberships(userId: string): Promise<MembershipRow[]> {
    return this.prisma.unscoped.userWorkspace.findMany({
      where: { userId, status: 'ACTIVE', workspace: { status: 'ACTIVE' } },
      include: {
        workspace: { select: { id: true, name: true } },
        roles: { include: { role: { select: { name: true, permissions: true, isOwner: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private permissionsOf(membership: MembershipRow): string[] {
    const granted = new Set<string>();
    for (const { role } of membership.roles) {
      const source = role.isOwner ? [...WORKSPACE_PERMISSIONS] : role.permissions;
      for (const permission of source) {
        if (isPermission(permission) && !PLATFORM_ONLY.has(permission)) granted.add(permission);
      }
    }
    return [...granted].sort();
  }

  /** Creates the session row (new family unless rotating) and the access token. */
  private async startSession(
    userId: string,
    membership: MembershipRow,
    familyId?: string,
  ): Promise<TokenPair> {
    const now = this.clock.now();
    const family = familyId ?? (await import('node:crypto')).randomUUID();
    const refresh = this.tokens.newRefreshToken();
    await this.prisma.unscoped.userSession.create({
      data: {
        userId,
        workspaceId: membership.workspaceId,
        familyId: family,
        refreshTokenHash: refresh.hash,
        expiresAt: new Date(now.getTime() + this.tokens.refreshTtlSeconds * 1000),
        ipAddress: this.cls.get('ip') ?? null,
        userAgent: this.cls.get('userAgent') ?? null,
      },
    });
    const accessToken = this.tokens.signAccessToken({
      sub: userId,
      tenantId: membership.workspaceId,
      mid: membership.id,
      permissions: this.permissionsOf(membership),
      pv: membership.permVersion,
      fam: family,
    });
    if (!familyId) {
      await this.audit.recordAsync({
        workspaceId: membership.workspaceId,
        action: 'auth.login',
        entityType: 'User',
        entityId: userId,
        actor: { userId },
      });
    }
    return { accessToken, refreshToken: refresh.token, expiresIn: this.tokens.accessTtlSeconds };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.unscoped.userSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }

  private async recordLoginAttempt(email: string, success: boolean): Promise<void> {
    await this.prisma.unscoped.loginAttempt.create({
      data: { email, success, ipAddress: this.cls.get('ip') ?? null },
    });
  }

  private async handleFailedLogin(email: string, userId?: string): Promise<void> {
    const now = this.clock.now();
    await this.recordLoginAttempt(email, false);
    if (!userId) return;

    const windowStart = new Date(now.getTime() - LOCK_WINDOW_MS);
    const lastSuccess = await this.prisma.unscoped.loginAttempt.findFirst({
      where: { email, success: true },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const since =
      lastSuccess && lastSuccess.createdAt > windowStart ? lastSuccess.createdAt : windowStart;
    const failures = await this.prisma.unscoped.loginAttempt.count({
      where: { email, success: false, createdAt: { gt: since } },
    });

    await this.auditForUserWorkspaces(userId, 'auth.login_failed');
    if (failures >= MAX_FAILED_LOGINS) {
      await this.prisma.unscoped.user.update({
        where: { id: userId },
        data: { lockedUntil: new Date(now.getTime() + LOCK_WINDOW_MS) },
      });
      await this.auditForUserWorkspaces(userId, 'auth.account_locked');
    }
  }

  /** Audit events belong to a workspace; for events before a workspace is chosen, record in each of the user's. */
  private async auditForUserWorkspaces(userId: string, action: string): Promise<void> {
    const rows = await this.prisma.unscoped.userWorkspace.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    await Promise.all(
      rows.map((r) =>
        this.audit.recordAsync({
          workspaceId: r.workspaceId,
          action,
          entityType: 'User',
          entityId: userId,
          actor: { userId },
        }),
      ),
    );
  }
}
