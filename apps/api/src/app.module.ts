import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { RequestContextModule } from './common/context/request-context';
import { EventsModule } from './common/events/events.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { SchedulingModule } from './common/scheduling/scheduling.module';
import { ConfigModule } from './config/config.module';
import { RolesModule } from './modules/roles/roles.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CrmModule } from './modules/crm/crm.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { FinanceModule } from './modules/finance/finance.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { SalesModule } from './modules/sales/sales.module';
import { FieldsModule } from './modules/fields/fields.module';
import { NumberingModule } from './modules/numbering/numbering.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { SearchModule } from './modules/search/search.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { FilesModule } from './modules/files/files.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule,
    RequestContextModule,
    CommonModule,
    EventsModule,
    SchedulingModule,
    HealthModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    RolesModule,
    SettingsModule,
    FilesModule,
    FieldsModule,
    WorkflowsModule,
    SearchModule,
    PricingModule,
    NumberingModule,
    CatalogModule,
    CrmModule,
    FinanceModule,
    InventoryModule,
    SalesModule,
    DocumentsModule,
  ],
})
export class AppModule {}
