import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from './config/env';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  loadEnv(); // exits with a clear message when the environment is invalid
  const app = await NestFactory.create(AppModule);
  await app.listen(4000);
}

void bootstrap();
