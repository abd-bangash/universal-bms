import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** The authenticated caller, taken from the verified access token. */
export interface AuthUser {
  userId: string;
  workspaceId: string;
  membershipId: string;
  permissions: string[];
  permVersion: number;
  /** Session family of the access token */
  familyId: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
  },
);
