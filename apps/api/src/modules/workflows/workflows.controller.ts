import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { WorkflowService } from './workflow.service';
import { WORKFLOW_ENTITY_TYPES, type WorkflowEntityType } from './workflow.types';

class EntityTypeParam {
  @IsIn(WORKFLOW_ENTITY_TYPES as unknown as string[]) entityType!: WorkflowEntityType;
}

@ApiTags('workflows')
@ApiBearerAuth()
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowService) {}

  @Get(':entityType')
  @RequirePermission('workflow:view')
  async get(@Param() p: EntityTypeParam) {
    const workflow = await this.workflows.get(p.entityType);
    return { ...workflow, missingSystemRoles: this.workflows.missingSystemRoles(workflow) };
  }
}
