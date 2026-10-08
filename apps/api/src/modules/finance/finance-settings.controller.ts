import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { AppException } from '../../common/errors/app.exception';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  CreateAccountDto,
  CreateMethodDto,
  ListFinanceQuery,
  UpdateAccountDto,
  UpdateMethodDto,
} from './dto/finance-settings.dto';
import { FinanceSettingsService } from './finance-settings.service';

/** Whoever records money needs to see the accounts and methods to choose from. */
const READERS = ['account:view', 'payment:create', 'expense:create', 'pos:sell'];
function assertMayList(user: AuthUser): void {
  if (!READERS.some((p) => user.permissions.includes(p))) {
    throw new AppException('PERMISSION_DENIED', 403, 'You do not have permission to do this');
  }
}

@ApiTags('finance-settings')
@ApiBearerAuth()
@Controller('settings')
export class FinanceSettingsController {
  constructor(private readonly settings: FinanceSettingsService) {}

  @Get('financial-accounts')
  @Authenticated()
  accounts(@CurrentUser() user: AuthUser, @Query() query: ListFinanceQuery) {
    assertMayList(user);
    return this.settings.listAccounts(user, query.includeInactive);
  }

  @Post('financial-accounts')
  @RequirePermission('account:configure')
  createAccount(@CurrentUser() user: AuthUser, @Body() dto: CreateAccountDto) {
    return this.settings.createAccount(user, dto);
  }

  @Patch('financial-accounts/:id')
  @RequirePermission('account:configure')
  updateAccount(@Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.settings.updateAccount(id, dto);
  }

  @Get('payment-methods')
  @Authenticated()
  methods(@CurrentUser() user: AuthUser, @Query() query: ListFinanceQuery) {
    assertMayList(user);
    return this.settings.listMethods(query.includeInactive);
  }

  @Post('payment-methods')
  @RequirePermission('account:configure')
  createMethod(@CurrentUser() user: AuthUser, @Body() dto: CreateMethodDto) {
    return this.settings.createMethod(user, dto);
  }

  @Patch('payment-methods/:id')
  @RequirePermission('account:configure')
  updateMethod(@Param('id') id: string, @Body() dto: UpdateMethodDto) {
    return this.settings.updateMethod(id, dto);
  }
}
