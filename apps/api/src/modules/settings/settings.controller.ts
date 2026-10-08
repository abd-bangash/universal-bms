import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IndustryProfileService } from '../tenants/industry-profile.service';
import {
  CreateTaxClassDto,
  CreateUnitDto,
  ProfileKeyParam,
  UpdateTaxClassDto,
  UpdateUnitDto,
} from './dto/settings.dto';
import { ReferenceDataService } from './reference-data.service';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly reference: ReferenceDataService,
    private readonly profiles: IndustryProfileService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('workspace:view')
  get() {
    return this.settings.snapshot();
  }

  @Patch()
  @RequirePermission('workspace:configure')
  update(@Body() body: Record<string, unknown>) {
    return this.settings.update(body);
  }

  @Get('industry-profiles')
  @RequirePermission('workspace:view')
  async industryProfiles() {
    const [available, current] = await Promise.all([
      this.profiles.list(),
      this.settings.industryProfileKey(),
    ]);
    return available.map((p) => ({ ...p, isCurrent: p.key === current }));
  }

  @Post('apply-profile/:key')
  @RequirePermission('workspace:configure')
  @HttpCode(200)
  applyProfile(@CurrentUser() user: AuthUser, @Param() params: ProfileKeyParam) {
    return this.prisma.scoped.$transaction(async (tx) => {
      const result = await this.profiles.apply(user.workspaceId, params.key, tx as never);
      await this.audit.record(tx, {
        action: 'settings.apply_profile',
        entityType: 'Workspace',
        entityId: user.workspaceId,
        after: { industryProfile: params.key },
        metadata: { ...result },
      });
      return result;
    });
  }

  // Reference data is readable by any member (forms need it); only changes need workspace:configure.
  @Get('units')
  @Authenticated()
  units() {
    return this.reference.listUnits();
  }

  @Post('units')
  @RequirePermission('workspace:configure')
  createUnit(@CurrentUser() user: AuthUser, @Body() dto: CreateUnitDto) {
    return this.reference.createUnit(user, dto);
  }

  @Patch('units/:id')
  @RequirePermission('workspace:configure')
  updateUnit(@Param('id') id: string, @Body() dto: UpdateUnitDto) {
    return this.reference.updateUnit(id, dto);
  }

  @Get('tax-classes')
  @Authenticated()
  taxClasses() {
    return this.reference.listTaxClasses();
  }

  @Post('tax-classes')
  @RequirePermission('workspace:configure')
  createTaxClass(@CurrentUser() user: AuthUser, @Body() dto: CreateTaxClassDto) {
    return this.reference.createTaxClass(user, dto);
  }

  @Patch('tax-classes/:id')
  @RequirePermission('workspace:configure')
  updateTaxClass(@Param('id') id: string, @Body() dto: UpdateTaxClassDto) {
    return this.reference.updateTaxClass(id, dto);
  }
}
