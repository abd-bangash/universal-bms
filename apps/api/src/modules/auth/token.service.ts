import { createHash, createSign, createVerify, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AccessTokenPayload } from '@bms/types';
import { ENV, type Env } from '../../config/env';
import { Clock } from './clock';
import { parseDurationSeconds } from './duration';

const b64 = (value: string | Buffer): string => Buffer.from(value).toString('base64url');
const LOGIN_TICKET_SECONDS = 5 * 60;

export interface LoginTicketPayload {
  sub: string;
  purpose: 'login';
  iat: number;
  exp: number;
}

@Injectable()
export class TokenService {
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;

  constructor(
    @Inject(ENV)
    private readonly env: Pick<
      Env,
      'JWT_PRIVATE_KEY' | 'JWT_PUBLIC_KEY' | 'ACCESS_TOKEN_TTL' | 'REFRESH_TOKEN_TTL'
    >,
    private readonly clock: Clock,
  ) {
    this.accessTtlSeconds = parseDurationSeconds(env.ACCESS_TOKEN_TTL);
    this.refreshTtlSeconds = parseDurationSeconds(env.REFRESH_TOKEN_TTL);
  }

  /** RS256 access token valid for one workspace (design.md "Access token"). */
  signAccessToken(
    claims: Omit<AccessTokenPayload, 'iat' | 'exp'>,
    overrides?: Partial<Pick<AccessTokenPayload, 'iat' | 'exp'>>,
  ): string {
    const iat = Math.floor(this.clock.now().getTime() / 1000);
    return this.sign({ ...claims, iat, exp: iat + this.accessTtlSeconds, ...overrides });
  }

  signLoginTicket(userId: string): string {
    const iat = Math.floor(this.clock.now().getTime() / 1000);
    const payload: LoginTicketPayload = {
      sub: userId,
      purpose: 'login',
      iat,
      exp: iat + LOGIN_TICKET_SECONDS,
    };
    return this.sign(payload);
  }

  /** Verifies signature, algorithm and expiry. Returns null for anything invalid. */
  verify<T extends { exp: number }>(token: string): T | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts as [string, string, string];
    try {
      const head = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as {
        alg?: string;
      };
      if (head.alg !== 'RS256') return null;
      const ok = createVerify('RSA-SHA256')
        .update(`${header}.${body}`)
        .verify(this.env.JWT_PUBLIC_KEY, Buffer.from(signature, 'base64url'));
      if (!ok) return null;
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
      if (typeof payload.exp !== 'number' || payload.exp * 1000 <= this.clock.now().getTime())
        return null;
      return payload;
    } catch {
      return null;
    }
  }

  verifyLoginTicket(ticket: string): LoginTicketPayload | null {
    const payload = this.verify<LoginTicketPayload>(ticket);
    return payload && payload.purpose === 'login' ? payload : null;
  }

  /** Opaque 256-bit refresh token and its SHA-256 hash (only the hash is stored). */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: TokenService.hash(token) };
  }

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private sign(payload: object): string {
    const signingInput = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify(payload))}`;
    const signature = createSign('RSA-SHA256').update(signingInput).sign(this.env.JWT_PRIVATE_KEY);
    return `${signingInput}.${b64(signature)}`;
  }
}
