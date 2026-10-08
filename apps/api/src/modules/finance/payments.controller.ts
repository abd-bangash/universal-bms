import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  ApplyCreditDto,
  ListPaymentsQuery,
  RecordPaymentDto,
  RejectPaymentDto,
  VoidPaymentDto,
} from './dto/payments.dto';
import { PaymentsService } from './payments.service';

class IdParam {
  @IsString() id!: string;
}

@ApiTags('payments')
@ApiBearerAuth()
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments')
  @RequirePermission('payment:view')
  list(@Query() query: ListPaymentsQuery) {
    return this.payments.list(query);
  }

  @Post('payments')
  @Idempotent()
  @RequirePermission('payment:create')
  record(@CurrentUser() user: AuthUser, @Body() dto: RecordPaymentDto) {
    return this.payments.record(user, dto);
  }

  @Get('payments/:id')
  @RequirePermission('payment:view')
  get(@Param() p: IdParam) {
    return this.payments.get(p.id);
  }

  @Get('payments/:id/receipt')
  @RequirePermission('payment:view')
  receipt(@Param() p: IdParam) {
    return this.payments.receiptOf(p.id);
  }

  @Post('payments/:id/confirm')
  @RequirePermission('payment:confirm')
  @HttpCode(200)
  confirm(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.payments.confirm(user, p.id);
  }

  @Post('payments/:id/reject')
  @RequirePermission('payment:confirm')
  @HttpCode(200)
  reject(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: RejectPaymentDto) {
    return this.payments.reject(user, p.id, dto.reason);
  }

  @Post('payments/:id/void')
  @RequirePermission('payment:void')
  @HttpCode(200)
  void(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: VoidPaymentDto) {
    return this.payments.void(user, p.id, dto.reason);
  }

  @Get('customers/:id/credit')
  @RequirePermission('payment:view')
  credit(@Param() p: IdParam) {
    return this.payments.creditOf(p.id);
  }

  // Applying credit moves no money but settles part of an order, so it needs the right to confirm
  // (the design lists payment:create here; this is stricter)
  @Post('customers/:id/credit/apply')
  @RequirePermission('payment:confirm')
  @HttpCode(201)
  applyCredit(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: ApplyCreditDto) {
    return this.payments.applyCredit(user, p.id, dto);
  }

  @Post('orders/:id/overpayment-to-credit')
  @RequirePermission('payment:confirm')
  @HttpCode(200)
  overpaymentToCredit(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.payments.moveOverpaymentToCredit(user, p.id);
  }
}
