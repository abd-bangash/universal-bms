process.env.TZ = 'UTC'; // timestamps are stored and returned in UTC; conversion happens at the edges

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureApp } from './app.setup';
import { loadEnv } from './config/env';
import { AppLogger } from './common/logging/app-logger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const env = loadEnv(); // exits with a clear message when the environment is invalid
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(AppLogger));
  configureApp(app, env);
  await app.listen(4000);
}

void bootstrap();
