import { Global, Module } from '@nestjs/common';
import { AdapterRunner } from './adapter-runner';
import { IntegrationProviderRegistry } from './integration-provider.registry';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

/** Connections to outside services: encrypted credentials, status, and the one way calls go out (task 70). */
@Global()
@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationProviderRegistry, AdapterRunner, IntegrationsService],
  exports: [IntegrationProviderRegistry, AdapterRunner, IntegrationsService],
})
export class IntegrationsModule {}
