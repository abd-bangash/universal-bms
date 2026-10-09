import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SystemService, type SystemStatusDto } from './system.service';

@ApiTags('system')
@ApiBearerAuth()
@Controller('system')
export class SystemController {
  constructor(private readonly system: SystemService) {}

  /** Owner-only: `system:view` is held by the Owner role and by no other default role. */
  @Get('status')
  @RequirePermission('system:view')
  status(): Promise<SystemStatusDto> {
    return this.system.status();
  }
}
