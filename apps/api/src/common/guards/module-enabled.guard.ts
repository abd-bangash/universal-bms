import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_MODULE_KEY } from '../decorators/require-module.decorator';
import type { AuthUser } from '../decorators/current-user.decorator';
import { AppException } from '../errors/app.exception';
import { SettingsService } from '../../modules/settings/settings.service';

/** Between JwtAuthGuard and PermissionGuard: refuses routes of a module the workspace has switched off. */
@Injectable()
export class ModuleEnabledGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const module = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!module) return true;
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) return true; // public route: nothing to check; unauthenticated callers never reach here
    if (!(await this.settings.moduleEnabled(module, user.workspaceId))) {
      throw new AppException(
        'MODULE_DISABLED',
        403,
        'This module is switched off for your workspace',
      );
    }
    return true;
  }
}
