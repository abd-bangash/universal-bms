import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CheckoutDto, ListReceiptsQuery } from './dto/pos.dto';
import { PosService } from './pos.service';

@ApiTags('pos')
@ApiBearerAuth()
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get('sessions/current')
  @RequirePermission('pos:sell')
  session(@CurrentUser() user: AuthUser) {
    return this.pos.currentSession(user);
  }

  @Post('checkout')
  @Idempotent()
  @RequirePermission('pos:sell')
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.pos.checkout(user, dto);
  }

  @Get('receipts')
  @RequirePermission('pos:sell')
  receipts(@Query() query: ListReceiptsQuery) {
    return this.pos.receipts(query);
  }

  @Get('receipts/:id')
  @RequirePermission('pos:sell')
  receipt(@Param('id') id: string) {
    return this.pos.receipt(id);
  }

  @Post('receipts/:id/reprint')
  @RequirePermission('pos:reprint')
  @HttpCode(200)
  reprint(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.pos.reprint(user, id);
  }
}
