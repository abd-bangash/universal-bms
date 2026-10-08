import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { ReportRegistry } from './report.registry';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';

/** Reports and the dashboard (tasks 63 to 66). */
@Module({
  controllers: [ReportingController],
  providers: [ReportRegistry, ReportingService, DashboardService],
  exports: [ReportingService, ReportRegistry],
})
export class ReportingModule {}
