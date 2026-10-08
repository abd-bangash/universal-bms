import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreateFieldDto, ListFieldsQuery, UpdateFieldDto } from './dto/fields.dto';
import { FieldsService } from './fields.service';

class FieldIdParam {
  @IsString() id!: string;
}

@ApiTags('fields')
@ApiBearerAuth()
@Controller('fields')
export class FieldsController {
  constructor(private readonly fields: FieldsService) {}

  // Every form needs the definitions, so any member can read them; only changes need field:configure.
  @Get()
  @Authenticated()
  list(@Query() query: ListFieldsQuery) {
    return this.fields.list(query.entityType, query.includeInactive);
  }

  @Post()
  @RequirePermission('field:configure')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFieldDto) {
    return this.fields.create(user, dto);
  }

  @Patch(':id')
  @RequirePermission('field:configure')
  update(@Param() params: FieldIdParam, @Body() dto: UpdateFieldDto) {
    return this.fields.update(params.id, dto);
  }
}
