import { Injectable, type LoggerService } from '@nestjs/common';
import type { Logger } from 'pino';
import { createLogger } from './logger';

export const LOGGER = Symbol('LOGGER');

/** Adapts pino to Nest's LoggerService so framework logs share the redaction rules. */
@Injectable()
export class AppLogger implements LoggerService {
  constructor(readonly pino: Logger = createLogger(process.env.LOG_LEVEL ?? 'info')) {}

  log(message: unknown, ...rest: unknown[]): void {
    this.pino.info({ context: rest[0] }, String(message));
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.pino.error({ context: rest[1] ?? rest[0] }, String(message));
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.pino.warn({ context: rest[0] }, String(message));
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.pino.debug({ context: rest[0] }, String(message));
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.pino.trace({ context: rest[0] }, String(message));
  }
}
