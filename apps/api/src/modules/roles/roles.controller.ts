import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreateRoleDto, DeleteRoleQuery, UpdateRoleDto } from './dto/roles.dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('roles')
  @RequirePermission('role:view')
  list() {
    return this.roles.list();
  }

  @Post('roles')
  @RequirePermission('role:configure')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto) {
    return this.roles.create(user, dto);
  }

  @Patch('roles/:id')
  @RequirePermission('role:configure')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(user, id, dto);
  }

  @Delete('roles/:id')
  @RequirePermission('role:configure')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: DeleteRoleQuery,
  ): Promise<void> {
    await this.roles.remove(user, id, query.fallbackRoleId);
  }

  @Get('permissions')
  @RequirePermission('role:view')
  permissions() {
    return this.roles.catalogue();
  }
}
