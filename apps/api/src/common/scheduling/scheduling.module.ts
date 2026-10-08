import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { WorkspaceJobRunner } from './workspace-job-runner';

@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [WorkspaceJobRunner],
  exports: [WorkspaceJobRunner],
})
export class SchedulingModule {}
