import { Global, Module } from '@nestjs/common';
import { ReferenceDataService } from './reference-data.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService, ReferenceDataService],
  exports: [SettingsService],
})
export class SettingsModule {}
