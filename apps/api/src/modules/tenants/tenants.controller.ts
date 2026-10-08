import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AuthThrottle } from '../../common/throttle/throttle';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantsService } from './tenants.service';

@ApiTags('tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /** Public only when ALLOW_PUBLIC_SIGNUP is true; otherwise needs a Platform_Admin's token. */
  @Post()
  @Public()
  @AuthThrottle()
  @HttpCode(201)
  async create(@Body() dto: CreateTenantDto, @Headers('authorization') authorization?: string) {
    await this.tenants.assertMayCreate(authorization);
    const created = await this.tenants.createWorkspace(dto);
    return {
      workspace: {
        id: created.workspaceId,
        name: dto.name,
        slug: created.slug,
        industryProfile: dto.industryProfile,
      },
      owner: { userId: created.ownerUserId, email: dto.owner.email.trim().toLowerCase() },
    };
  }
}
