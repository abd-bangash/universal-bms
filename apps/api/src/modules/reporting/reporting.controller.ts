import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
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

  /** The report as a CSV download; needs `report:export` as well as the report's own permissions (Requirement 19.6). */
  @Post(':key/export')
  @RequirePermission('report:export')
  @HttpCode(200)
  @SkipEnvelope()
  async export(
    @CurrentUser() user: AuthUser,
    @Param() p: KeyParam,
    @Body() body: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.reports.exportCsv(user, p.key, body);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(file.stream);
  }
}
