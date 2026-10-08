import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { InviteUserDto, ListUsersQuery, UpdateUserDto } from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('user:view')
  list(@Query() query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Post('invite')
  @RequirePermission('user:create')
  invite(@CurrentUser() actor: AuthUser, @Body() dto: InviteUserDto) {
    return this.users.invite(actor, dto);
  }

  @Get(':id')
  @RequirePermission('user:view')
  get(@Param('id') id: string) {
    return this.users.get(id);
  }

  @Patch(':id')
  @RequirePermission('user:edit')
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(actor, id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermission('user:deactivate')
  @HttpCode(200)
  deactivate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.deactivate(actor, id);
  }

  @Post(':id/reactivate')
  @RequirePermission('user:deactivate')
  @HttpCode(200)
  reactivate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.reactivate(actor, id);
  }

  @Post(':id/reset-link')
  @RequirePermission('user:edit')
  @HttpCode(200)
  resetLink(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.createResetLink(actor, id);
  }
}
