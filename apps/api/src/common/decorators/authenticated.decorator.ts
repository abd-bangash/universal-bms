import { SetMetadata } from '@nestjs/common';

export const AUTHENTICATED_KEY = 'authenticatedOnly';

/**
 * For self-service routes that need a valid session but no specific permission (my profile,
 * my sessions, change my password). Every use is listed in the route scan test.
 */
export const Authenticated = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTHENTICATED_KEY, true);
