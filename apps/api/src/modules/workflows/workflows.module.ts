import { Global, Module } from '@nestjs/common';
import { WorkflowRegistry } from './workflow.registry';
import { WorkflowService } from './workflow.service';
import { WorkflowsController } from './workflows.controller';

@Global()
@Module({
  controllers: [WorkflowsController],
  providers: [WorkflowService, WorkflowRegistry],
  exports: [WorkflowService, WorkflowRegistry],
})
export class WorkflowsModule {}
