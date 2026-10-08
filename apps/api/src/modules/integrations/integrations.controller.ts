import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ConnectIntegrationDto } from './dto/integrations.dto';
import { IntegrationsService } from './integrations.service';

class IdParam {
  @IsString() id!: string;
}

@ApiTags('integrations')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  /** The kinds of connection that can be made, and the ones this workspace has (credentials masked). */
  @Get()
  @RequirePermission('integration:view')
  async list() {
    return {
      providers: this.integrations.providerCatalogue(),
      connections: await this.integrations.list(),
    };
  }

  @Post()
  @RequirePermission('integration:manage')
  connect(@CurrentUser() user: AuthUser, @Body() dto: ConnectIntegrationDto) {
    return this.integrations.connect(user, dto);
  }

  @Get(':id')
  @RequirePermission('integration:view')
  get(@Param() p: IdParam) {
    return this.integrations.get(p.id);
  }

  @Post(':id/test')
  @RequirePermission('integration:manage')
  @HttpCode(200)
  test(@Param() p: IdParam) {
    return this.integrations.test(p.id);
  }

  @Post(':id/disconnect')
  @RequirePermission('integration:manage')
  @HttpCode(200)
  disconnect(@Param() p: IdParam) {
    return this.integrations.disconnect(p.id);
  }
}
