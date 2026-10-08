import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';
/**
 * The POST handler requires an `Idempotency-Key` header: repeating the request with the same key
 * returns the first response and creates nothing more (design.md, Idempotency and Concurrency).
 */
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT_KEY, true);
