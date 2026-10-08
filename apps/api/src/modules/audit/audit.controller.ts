import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { Page } from '../../common/pagination/pagination';
import { AuditQueryService } from './audit-query.service';
import type { AuditEventDto } from './dto/audit-event.dto';
import { ListAuditEventsQuery } from './dto/list-audit-events.dto';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly query: AuditQueryService) {}

  @Get('events')
  @RequirePermission('audit:view')
  list(@Query() query: ListAuditEventsQuery): Promise<Page<AuditEventDto>> {
    return this.query.list(query);
  }
}
