import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { RequestContextModule } from './common/context/request-context';
import { PrismaModule } from './common/prisma/prisma.module';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [ConfigModule, RequestContextModule, CommonModule, HealthModule, PrismaModule],
})
export class AppModule {}
