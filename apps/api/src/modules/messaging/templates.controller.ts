import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreateTemplateDto, ListTemplatesQuery, UpdateTemplateDto } from './dto/messaging.dto';
import { TemplatesService } from './templates.service';

class IdParam {
  @IsString() id!: string;
}

@ApiTags('templates')
@ApiBearerAuth()
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequirePermission('template:view')
  list(@Query() query: ListTemplatesQuery) {
    return this.templates.list(query);
  }

  @Post()
  @RequirePermission('template:configure')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTemplateDto) {
    return this.templates.create(user, dto);
  }

  /** Reads the provider's approved templates into this list. */
  @Post('sync')
  @HttpCode(200)
  @RequirePermission('template:configure')
  sync(@CurrentUser() user: AuthUser) {
    return this.templates.syncProvider(user, 'WHATSAPP');
  }

  @Patch(':id')
  @RequirePermission('template:configure')
  update(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: UpdateTemplateDto) {
    return this.templates.update(user, p.id, dto);
  }
}
