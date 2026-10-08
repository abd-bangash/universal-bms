import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { AccessTokenPayload } from '@bms/types';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { ENV, type Env } from '../../config/env';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(@Inject(ENV) env: Pick<Env, 'JWT_PUBLIC_KEY'>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: env.JWT_PUBLIC_KEY,
      algorithms: ['RS256'],
      ignoreExpiration: false,
    });
  }

  validate(payload: Partial<AccessTokenPayload>): AuthUser {
    // Login tickets are signed with the same key but carry no membership: never accepted here.
    if (
      !payload.sub ||
      !payload.tenantId ||
      !payload.mid ||
      !payload.fam ||
      !Array.isArray(payload.permissions)
    ) {
      throw new UnauthorizedException();
    }
    return {
      userId: payload.sub,
      workspaceId: payload.tenantId,
      membershipId: payload.mid,
      permissions: payload.permissions,
      permVersion: payload.pv ?? 0,
      familyId: payload.fam,
    };
  }
}
