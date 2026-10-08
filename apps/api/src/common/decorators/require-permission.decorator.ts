import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';

/**
 * Declares the permission (`resource:action`) a route needs. Enforced by PermissionGuard (task 8);
 * a route scan test fails when a non-public route has none.
 */
export const RequirePermission = (permission: string): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);
