import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AppException } from '../../common/errors/app.exception';
import {
  ChangePurchaseStatusDto,
  CreatePurchaseDto,
  ListPurchasesQuery,
  QuickPurchaseDto,
  ReceivePurchaseDto,
  UpdatePurchaseDto,
} from './dto/purchasing.dto';
import { PurchasesService } from './purchases.service';

class IdParam {
  @IsString() id!: string;
}

@ApiTags('purchases')
@ApiBearerAuth()
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  @RequirePermission('purchase:view')
  list(@Query() query: ListPurchasesQuery) {
    return this.purchases.list(query);
  }

  @Post()
  @RequirePermission('purchase:create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePurchaseDto) {
    return this.purchases.create(user, dto);
  }

  /** Create and receive in full in one step; needs both permissions. */
  @Post('quick')
  @Idempotent()
  @RequirePermission('purchase:create')
  quick(@CurrentUser() user: AuthUser, @Body() dto: QuickPurchaseDto) {
    if (!user.permissions.includes('purchase:receive')) {
      throw new AppException('PERMISSION_DENIED', 403, 'You do not have permission to do this');
    }
    return this.purchases.quick(user, dto);
  }

  @Get(':id')
  @RequirePermission('purchase:view')
  get(@Param() p: IdParam) {
    return this.purchases.get(p.id);
  }

  @Patch(':id')
  @RequirePermission('purchase:edit')
  update(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: UpdatePurchaseDto) {
    return this.purchases.update(user, p.id, dto);
  }

  @Post(':id/status')
  @RequirePermission('purchase:edit')
  @HttpCode(200)
  status(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: ChangePurchaseStatusDto) {
    return this.purchases.changeStatus(user, p.id, dto);
  }

  @Post(':id/receive')
  @Idempotent()
  @RequirePermission('purchase:receive')
  @HttpCode(201)
  receive(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: ReceivePurchaseDto) {
    return this.purchases.receive(user, p.id, dto);
  }
}
