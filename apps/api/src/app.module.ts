import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './modules/health/health.module';

@Module({ imports: [ConfigModule, CommonModule, HealthModule] })
export class AppModule {}
