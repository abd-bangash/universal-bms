import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import type { Logger } from 'pino';
import { MembershipCache } from '../../modules/auth/membership-cache';
import { AuditService } from '../../modules/audit/audit.service';
import { AUTHENTICATED_KEY } from '../decorators/authenticated.decorator';
import type { AuthUser } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRED_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import type { RequestContext } from '../context/request-context';
import { AppException } from '../errors/app.exception';
import { LOGGER } from '../logging/app-logger';

/**
 * Runs after JwtAuthGuard on every route. Checks that the token is still current (permVersion),
 * puts the workspace and user into the request context, and enforces `@RequirePermission`.
 * A route with neither @Public, @Authenticated nor @RequirePermission is refused (fail closed).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<RequestContext>,
    private readonly memberships: MembershipCache,
    private readonly audit: AuditService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthUser; method: string; path: string }>();
    const user = request.user;
    if (!user) throw new AppException('UNAUTHENTICATED', 401, 'Authentication is required');

    const membership = await this.memberships.get(user.membershipId);
    if (!membership?.active || membership.permVersion !== user.permVersion) {
      throw new AppException(
        'TOKEN_STALE',
        401,
        'Your permissions changed; sign in again or refresh',
      );
    }

    this.cls.set('workspaceId', user.workspaceId);
    this.cls.set('userId', user.userId);
    this.cls.set('actorRole', membership.roleNames.join(', '));

    if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRED_PERMISSION_KEY,
      targets,
    );
    if (!required) {
      this.logger.error(
        { route: `${request.method} ${request.path}` },
        'route has no permission declared',
      );
      throw new AppException('PERMISSION_DENIED', 403, 'You do not have permission to do this');
    }
    if (!user.permissions.includes(required)) {
      await this.audit.recordAsync({
        action: 'auth.permission_denied',
        entityType: 'Route',
        entityId: `${request.method} ${request.path}`,
        metadata: { permission: required },
      });
      throw new AppException('PERMISSION_DENIED', 403, 'You do not have permission to do this');
    }
    return true;
  }
}
