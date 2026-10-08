import { Global, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { IdempotencyInterceptor } from './interceptors/idempotency.interceptor';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { ResponseEnvelopeInterceptor } from './interceptors/response-envelope.interceptor';
import { AppLogger, LOGGER } from './logging/app-logger';
import { createLogger } from './logging/logger';
import { RequestIdMiddleware } from './middleware/request-id.middleware';
import { createValidationPipe } from './pipes/validation.pipe';
import { AppThrottlerGuard, throttlerOptions } from './throttle/throttle';

@Global()
@Module({
  imports: [ThrottlerModule.forRoot(throttlerOptions)],
  providers: [
    { provide: LOGGER, useFactory: () => createLogger(process.env.LOG_LEVEL ?? 'info') },
    { provide: AppLogger, useFactory: (pino) => new AppLogger(pino), inject: [LOGGER] },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
  exports: [LOGGER, AppLogger],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*path');
  }
}
