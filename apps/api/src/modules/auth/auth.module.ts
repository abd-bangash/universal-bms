import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { THROTTLE_USER_RESOLVER } from '../../common/throttle/throttle';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Clock } from './clock';
import { JwtStrategy } from './jwt.strategy';
import { MembershipCache } from './membership-cache';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Global()
@Module({
  imports: [PassportModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    PasswordService,
    MembershipCache,
    Clock,
    JwtStrategy,
    {
      provide: THROTTLE_USER_RESOLVER,
      useFactory:
        (tokens: TokenService) =>
        (authorization: string | undefined): string | undefined => {
          const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
          return token
            ? (tokens.verify<{ sub?: string; exp: number }>(token)?.sub ?? undefined)
            : undefined;
        },
      inject: [TokenService],
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AuthService, TokenService, PasswordService, MembershipCache, Clock],
})
export class AuthModule {}
