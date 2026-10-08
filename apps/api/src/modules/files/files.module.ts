import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Global, Inject, Module, type OnModuleInit } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import type { StorageAdapter } from '@bms/types';
import { ENV, type Env } from '../../config/env';
import { ReadinessRegistry } from '../health/readiness';
import { FileReferenceRegistry } from './file-reference.registry';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { LocalDiskStorage } from './storage/local-disk.storage';
import { S3Storage } from './storage/s3.storage';
import { STORAGE } from './storage/storage.token';

/** Where the development driver keeps files (git-ignored). */
const LOCAL_ROOT = resolve(process.cwd(), '.local-storage');

export function createStorage(env: Env): StorageAdapter {
  if (env.STORAGE_DRIVER === 's3') {
    return new S3Storage({
      endpoint: env.S3_ENDPOINT as string,
      bucket: env.S3_BUCKET as string,
      accessKey: env.S3_ACCESS_KEY as string,
      secretKey: env.S3_SECRET_KEY as string,
      region: env.S3_REGION as string,
    });
  }
  const secret = createHash('sha256').update(`files:${env.JWT_PRIVATE_KEY}`).digest('hex');
  return new LocalDiskStorage(LOCAL_ROOT, env.API_BASE_URL, secret);
}

@Global()
@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Pick<Env, 'MAX_UPLOAD_MB'>) => ({
        limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 10 },
      }),
    }),
  ],
  controllers: [FilesController],
  providers: [
    FilesService,
    FileReferenceRegistry,
    { provide: STORAGE, useFactory: createStorage, inject: [ENV] },
  ],
  exports: [FilesService, FileReferenceRegistry],
})
export class FilesModule implements OnModuleInit {
  constructor(
    private readonly readiness: ReadinessRegistry,
    @Inject(STORAGE) private readonly storage: StorageAdapter,
  ) {}

  onModuleInit(): void {
    this.readiness.register({ name: 'storage', check: () => this.storage.ping() });
  }
}
