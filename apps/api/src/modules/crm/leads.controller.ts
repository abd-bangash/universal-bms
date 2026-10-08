import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { FilesService } from '../files/files.service';
import {
  AnalyticsQuery,
  AssignLeadDto,
  ChangeStageDto,
  ConvertLeadDto,
  CreateLeadDto,
  ListLeadsQuery,
  PipelineQuery,
  UpdateLeadDto,
} from './dto/leads.dto';
import { TimelineQuery } from './dto/customers.dto';
import { LeadAnalyticsService } from './lead-analytics.service';
import { LeadsService } from './leads.service';
import { TimelineService } from './timeline.service';

class IdParam {
  @IsString() id!: string;
}

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly analytics: LeadAnalyticsService,
    private readonly timeline: TimelineService,
    private readonly files: FilesService,
  ) {}

  @Get()
  @RequirePermission('lead:view')
  list(@CurrentUser() user: AuthUser, @Query() query: ListLeadsQuery, @Req() req: Request) {
    return this.leads.list(user, query, req.query as Record<string, unknown>);
  }

  // Declared before ':id' so these fixed paths are not read as ids.
  @Get('pipeline')
  @RequirePermission('lead:view')
  pipeline(@CurrentUser() user: AuthUser, @Query() query: PipelineQuery) {
    return this.leads.pipeline(user, query.cardsPerColumn);
  }

  @Get('analytics')
  @RequirePermission('lead:view')
  stats(@CurrentUser() user: AuthUser, @Query() query: AnalyticsQuery) {
    return this.analytics.compute(user, query);
  }

  /** 201 for a new lead; 200 with `existing: true` when an open lead for the contact was found. */
  @Post()
  @RequirePermission('lead:create')
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateLeadDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { lead, existing } = await this.leads.create(user, dto);
    res.status(existing ? 200 : 201);
    return { ...lead, existing };
  }

  @Get(':id')
  @RequirePermission('lead:view')
  get(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.leads.get(user, p.id);
  }

  @Patch(':id')
  @RequirePermission('lead:edit')
  update(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: UpdateLeadDto) {
    return this.leads.update(user, p.id, dto);
  }

  @Post(':id/stage')
  @RequirePermission('lead:edit')
  @HttpCode(200)
  stage(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: ChangeStageDto) {
    return this.leads.changeStage(user, p.id, dto);
  }

  @Post(':id/assign')
  @RequirePermission('lead:assign')
  @HttpCode(200)
  assign(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: AssignLeadDto) {
    return this.leads.assign(user, p.id, dto);
  }

  @Post(':id/convert')
  @RequirePermission('lead:edit')
  @HttpCode(200)
  convert(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: ConvertLeadDto) {
    return this.leads.convert(user, p.id, dto);
  }

  @Get(':id/timeline')
  @RequirePermission('lead:view')
  async timelineOf(
    @CurrentUser() user: AuthUser,
    @Param() p: IdParam,
    @Query() query: TimelineQuery,
  ) {
    await this.leads.row(user, p.id);
    return this.timeline.listFor({ leadId: p.id }, query);
  }

  /** Reference images and other files attached to the lead. */
  @Get(':id/attachments')
  @RequirePermission('lead:view')
  async attachments(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    await this.leads.row(user, p.id);
    return this.files.listForEntity('LEAD', p.id);
  }
}
