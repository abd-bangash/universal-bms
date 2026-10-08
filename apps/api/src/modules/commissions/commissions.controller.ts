import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { NotFoundAppException } from '../../common/errors/app.exception';
import { CommissionsService } from './commissions.service';
import {
  CreateRuleDto,
  ListCommissionsQuery,
  PayCommissionDto,
  PerformanceQuery,
  RejectCommissionDto,
  SetStaffCommissionDto,
  UpdateRuleDto,
} from './dto/commissions.dto';

class IdParam {
  @IsString() id!: string;
}
class UserParam {
  @IsString() userId!: string;
}

@ApiTags('commissions')
@ApiBearerAuth()
@Controller('commissions')
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @Get()
  @RequirePermission('commission:view')
  list(@CurrentUser() user: AuthUser, @Query() query: ListCommissionsQuery) {
    return this.commissions.list(user, query);
  }

  // the rule routes come before ":id" routes so "rules" is never read as an id
  @Get('rules')
  @RequirePermission('commission:configure')
  rules() {
    return this.commissions.rules();
  }

  @Post('rules')
  @RequirePermission('commission:configure')
  createRule(@CurrentUser() user: AuthUser, @Body() dto: CreateRuleDto) {
    return this.commissions.createRule(user, dto);
  }

  @Patch('rules/:id')
  @RequirePermission('commission:configure')
  updateRule(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: UpdateRuleDto) {
    return this.commissions.updateRule(user, p.id, dto);
  }

  @Post(':id/approve')
  @RequirePermission('commission:approve')
  @HttpCode(200)
  approve(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.commissions.approve(user, p.id);
  }

  @Post(':id/reject')
  @RequirePermission('commission:approve')
  @HttpCode(200)
  reject(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: RejectCommissionDto) {
    return this.commissions.reject(user, p.id, dto.reason);
  }

  @Post(':id/pay')
  @RequirePermission('commission:pay')
  @HttpCode(200)
  pay(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: PayCommissionDto) {
    return this.commissions.pay(user, p.id, dto);
  }
}

@ApiTags('staff')
@ApiBearerAuth()
@Controller('staff')
export class StaffCommissionController {
  constructor(private readonly commissions: CommissionsService) {}

  @Get(':userId/commission')
  @RequirePermission('commission:configure')
  percent(@Param() p: UserParam) {
    return this.commissions.staffPercent(p.userId);
  }

  @Put(':userId/commission')
  @RequirePermission('commission:configure')
  setPercent(
    @CurrentUser() user: AuthUser,
    @Param() p: UserParam,
    @Body() dto: SetStaffCommissionDto,
  ) {
    return this.commissions.setStaffPercent(user, p.userId, dto.percent);
  }

  /** A person sees their own results; anyone else's are not found unless they hold `commission:view_all` (Requirement 41.7). */
  @Get(':userId/performance')
  @RequirePermission('commission:view')
  performance(
    @CurrentUser() user: AuthUser,
    @Param() p: UserParam,
    @Query() query: PerformanceQuery,
  ) {
    if (p.userId !== user.userId && !user.permissions.includes('commission:view_all')) {
      throw new NotFoundAppException(); // someone else's results are simply not there for you
    }
    return this.commissions.performance(p.userId, query);
  }
}
