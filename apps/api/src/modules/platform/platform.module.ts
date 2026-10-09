import { Global, Module } from '@nestjs/common';
import { BackupStatusService } from './backup-status.service';

/** Facts about the installation as a whole rather than one business. */
@Global()
@Module({ providers: [BackupStatusService], exports: [BackupStatusService] })
export class PlatformModule {}
