import { Global, Module } from '@nestjs/common';
import { IndustryProfileService } from './industry-profile.service';
import { ProfileSectionRegistry, WorkspaceDefaultsRegistry } from './registries';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Global()
@Module({
  controllers: [TenantsController],
  providers: [
    TenantsService,
    IndustryProfileService,
    WorkspaceDefaultsRegistry,
    ProfileSectionRegistry,
  ],
  exports: [
    TenantsService,
    IndustryProfileService,
    WorkspaceDefaultsRegistry,
    ProfileSectionRegistry,
  ],
})
export class TenantsModule {}
