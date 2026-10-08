import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { Env } from './config/env';

export const API_PREFIX = 'api/v1';

/** Settings that need the app instance. Shared by main.ts and the integration tests. */
export function configureApp(
  app: INestApplication,
  env: Pick<Env, 'APP_ENV' | 'WEB_ORIGIN'>,
): void {
  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  });

  if (env.APP_ENV !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Universal BMS API').setVersion('1').addBearerAuth().build(),
    );
    SwaggerModule.setup('docs', app, document, { useGlobalPrefix: true });
  }
}
