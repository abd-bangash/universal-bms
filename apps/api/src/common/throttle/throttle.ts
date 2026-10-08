import { type ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerException,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';
import type { Request } from 'express';

export type ThrottleProfile = 'auth' | 'webhook';
const PROFILE_KEY = 'throttleProfile';

/** Authentication endpoints: 10 per minute per IP. */
export const AuthThrottle = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PROFILE_KEY, 'auth' satisfies ThrottleProfile);
/** Webhook endpoints: 600 per minute per provider. */
export const WebhookThrottle = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PROFILE_KEY, 'webhook' satisfies ThrottleProfile);

const reflector = new Reflector();
const profileOf = (ctx: ExecutionContext): ThrottleProfile | undefined =>
  reflector.getAllAndOverride<ThrottleProfile | undefined>(PROFILE_KEY, [
    ctx.getHandler(),
    ctx.getClass(),
  ]);

const MINUTE = 60_000;

/** Limits from design.md "Error Handling". Each throttler applies only to its own profile. */
export const throttlerOptions: ThrottlerModuleOptions = {
  throttlers: [
    {
      name: 'default',
      ttl: MINUTE,
      limit: 300,
      skipIf: (ctx) => profileOf(ctx) !== undefined,
    },
    {
      name: 'auth',
      ttl: MINUTE,
      limit: 10,
      skipIf: (ctx) => profileOf(ctx) !== 'auth',
    },
    {
      name: 'webhook',
      ttl: MINUTE,
      limit: 600,
      skipIf: (ctx) => profileOf(ctx) !== 'webhook',
      getTracker: (req) => `webhook:${String((req as Request).params?.provider ?? 'unknown')}`,
    },
  ],
};

/**
 * Tracks per user once a user is attached to the request, otherwise per IP.
 * (The per-user tracker becomes effective when the JWT guard runs ahead of this one, task 8.)
 */
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { userId?: string } | undefined;
    return user?.userId ? `user:${user.userId}` : String(req.ip ?? 'unknown');
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context);
    res.header('Retry-After', String(Math.max(1, detail.timeToBlockExpire || detail.timeToExpire)));
    throw new ThrottlerException();
  }
}
