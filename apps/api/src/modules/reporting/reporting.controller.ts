import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DashboardService } from './dashboard.service';
import { ReportQueryDto } from './dto/report-query.dto';
import { ReportingService } from './reporting.service';

class KeyParam {
  @IsString() key!: string;
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportingController {
  constructor(
    private readonly reports: ReportingService,
    private readonly dashboard: DashboardService,
  ) {}

  /** The reports this person may run. */
  @Get()
  @RequirePermission('report:view')
  catalogue(@CurrentUser() user: AuthUser) {
    return this.reports.catalogue(user);
  }

  /**
   * The Home page indicators. Every signed-in person may ask; each indicator is present only if
   * they hold the permissions behind it, so the answer is the same as the reports would give.
   */
  @Get('dashboard')
  @Authenticated()
  home(@CurrentUser() user: AuthUser) {
    return this.dashboard.forUser(user);
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
