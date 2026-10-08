import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CustomerFinanceService } from './customer-finance.service';
import { CustomersService } from './customers.service';
import {
  CreateCustomerDto,
  ListCustomersQuery,
  TimelineQuery,
  UpdateCustomerDto,
} from './dto/customers.dto';
import { TimelineService } from './timeline.service';

class IdParam {
  @IsString() id!: string;
}

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly timeline: TimelineService,
    private readonly finance: CustomerFinanceService,
  ) {}

  @Get()
  @RequirePermission('customer:view')
  list(@Query() query: ListCustomersQuery, @Req() req: Request) {
    return this.customers.list(query, req.query as Record<string, unknown>);
  }

  @Post()
  @RequirePermission('customer:create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.customers.create(user, dto);
  }

  @Get(':id')
  @RequirePermission('customer:view')
  get(@Param() p: IdParam) {
    return this.customers.get(p.id);
  }

  @Patch(':id')
  @RequirePermission('customer:edit')
  update(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(user, p.id, dto);
  }

  @Post(':id/archive')
  @RequirePermission('customer:archive')
  @HttpCode(200)
  archive(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.customers.archive(user, p.id);
  }

  @Post(':id/restore')
  @RequirePermission('customer:archive')
  @HttpCode(200)
  restore(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.customers.restore(user, p.id);
  }

  @Get(':id/timeline')
  @RequirePermission('customer:view')
  async timelineOf(@Param() p: IdParam, @Query() query: TimelineQuery) {
    await this.timeline.assertCustomer(p.id);
    return this.timeline.listFor({ customerId: p.id }, query);
  }

  @Get(':id/finance')
  @RequirePermission('payment:view')
  financeOf(@Param() p: IdParam) {
    return this.finance.summary(p.id);
  }
}
