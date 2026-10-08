import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  AcceptQuotationDto,
  CreateQuotationDto,
  ListQuotationsQuery,
  RejectQuotationDto,
  SendQuotationDto,
  UpdateQuotationDto,
} from './dto/quotations.dto';
import { QuotationsService } from './quotations.service';

class IdParam {
  @IsString() id!: string;
}

@ApiTags('quotations')
@ApiBearerAuth()
@Controller('quotations')
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get()
  @RequirePermission('quotation:view')
  list(@Query() query: ListQuotationsQuery) {
    return this.quotations.list(query);
  }

  @Post()
  @RequirePermission('quotation:create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateQuotationDto) {
    return this.quotations.create(user, dto);
  }

  @Get(':id')
  @RequirePermission('quotation:view')
  get(@Param() p: IdParam) {
    return this.quotations.get(p.id);
  }

  @Patch(':id')
  @RequirePermission('quotation:edit')
  update(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: UpdateQuotationDto) {
    return this.quotations.update(user, p.id, dto);
  }

  @Get(':id/attachments')
  @RequirePermission('quotation:view')
  attachments(@Param() p: IdParam) {
    return this.quotations.attachments(p.id);
  }

  @Post(':id/send')
  @RequirePermission('quotation:send')
  @HttpCode(200)
  send(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: SendQuotationDto) {
    return this.quotations.send(user, p.id, dto);
  }

  @Post(':id/accept')
  @RequirePermission('quotation:edit')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: AcceptQuotationDto) {
    return this.quotations.accept(user, p.id, dto);
  }

  @Post(':id/reject')
  @RequirePermission('quotation:edit')
  @HttpCode(200)
  reject(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: RejectQuotationDto) {
    return this.quotations.reject(user, p.id, dto);
  }

  @Post(':id/convert')
  @RequirePermission('order:create')
  @HttpCode(200)
  convert(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.quotations.convert(user, p.id);
  }
}
