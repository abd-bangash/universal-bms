import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ReportQueryDto } from './dto/report-query.dto';
import { ReportingService } from './reporting.service';

class KeyParam {
  @IsString() key!: string;
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportingController {
  constructor(private readonly reports: ReportingService) {}

  /** The reports this person may run. */
  @Get()
  @RequirePermission('report:view')
  catalogue(@CurrentUser() user: AuthUser) {
    return this.reports.catalogue(user);
  }

  @Get(':key')
  @RequirePermission('report:view')
  run(@CurrentUser() user: AuthUser, @Param() p: KeyParam, @Query() query: ReportQueryDto) {
    return this.reports.run(user, p.key, query);
  }

  @Get(':key/drilldown')
  @RequirePermission('report:view')
  drilldown(@CurrentUser() user: AuthUser, @Param() p: KeyParam, @Query() query: ReportQueryDto) {
    return this.reports.drilldown(user, p.key, query);
  }
}
