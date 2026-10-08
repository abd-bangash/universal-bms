import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppException } from '../errors/app.exception';

/** First guard after the throttler: verifies the Bearer access token and attaches `req.user`. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context) as Promise<boolean>;
  }

  override handleRequest<T>(err: unknown, user: T | false, info: { name?: string } | undefined): T {
    if (user) return user;
    if (info?.name === 'TokenExpiredError') {
      throw new AppException('TOKEN_EXPIRED', 401, 'The access token has expired');
    }
    throw new AppException('UNAUTHENTICATED', 401, 'Authentication is required');
  }
}
