import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { RequestContextModule } from './common/context/request-context';
import { EventsModule } from './common/events/events.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { SchedulingModule } from './common/scheduling/scheduling.module';
import { ConfigModule } from './config/config.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule,
    RequestContextModule,
    CommonModule,
    EventsModule,
    SchedulingModule,
    HealthModule,
    PrismaModule,
    AuditModule,
    AuthModule,
  ],
})
export class AppModule {}
