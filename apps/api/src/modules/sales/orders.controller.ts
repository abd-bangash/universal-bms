import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TimelineQuery } from '../crm/dto/customers.dto';
import {
  ChangeOrderStatusDto,
  CreateOrderDto,
  FulfilmentDto,
  ListOrdersQuery,
  UpdateOrderDto,
} from './dto/orders.dto';
import { OrdersService } from './orders.service';

class IdParam {
  @IsString() id!: string;
}

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermission('order:view')
  list(@CurrentUser() user: AuthUser, @Query() query: ListOrdersQuery) {
    return this.orders.list(user, query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('order:create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user, dto);
  }

  @Get(':id')
  @RequirePermission('order:view')
  get(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.orders.get(user, p.id);
  }

  @Patch(':id')
  @RequirePermission('order:edit')
  update(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: UpdateOrderDto) {
    return this.orders.update(user, p.id, dto);
  }

  @Post(':id/status')
  @RequirePermission('order:edit')
  @HttpCode(200)
  status(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: ChangeOrderStatusDto) {
    return this.orders.changeStatus(user, p.id, dto);
  }

  @Patch(':id/fulfilment')
  @RequirePermission('order:edit')
  fulfilment(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: FulfilmentDto) {
    return this.orders.fulfilment(user, p.id, dto);
  }

  @Get(':id/timeline')
  @RequirePermission('order:view')
  timeline(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Query() query: TimelineQuery) {
    return this.orders.timelineOf(user, p.id, query);
  }

  @Get(':id/status-history')
  @RequirePermission('order:view')
  history(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.orders.history(user, p.id);
  }

  @Get(':id/attachments')
  @RequirePermission('order:view')
  attachments(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.orders.attachments(user, p.id);
  }
}
