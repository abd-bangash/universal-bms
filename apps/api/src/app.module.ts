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
import { CommissionsModule } from './modules/commissions/commissions.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { AiModule } from './modules/ai/ai.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { QueueModule } from './modules/queue/queue.module';
import { PosModule } from './modules/pos/pos.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
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
    QueueModule,
    IntegrationsModule,
    ChannelsModule,
    MessagingModule,
    AiModule,
    NotificationsModule,
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
    PosModule,
    PurchasingModule,
    CommissionsModule,
    ReportingModule,
    SalesModule,
    DocumentsModule,
  ],
})
export class AppModule {}
