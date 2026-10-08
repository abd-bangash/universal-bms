import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@bms/types';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';

/**
 * Declares the permission (`resource:action`) a route needs. Enforced server-side by
 * PermissionGuard; a route scan test fails when a non-public route has neither this nor
 * @Authenticated.
 */
export const RequirePermission = (permission: Permission): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);
