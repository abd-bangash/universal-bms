import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Permission, StorageAdapter } from '@bms/types';
import sharp from 'sharp';
import type { Logger } from 'pino';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { LOGGER } from '../../common/logging/app-logger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ENV, type Env } from '../../config/env';
import { AuditService } from '../audit/audit.service';
import type { FileDto, FileUrlDto, UploadFileDto } from './dto/files.dto';
import { FILE_ENTITY_ACCESS, type FileEntityType, type FilePurpose } from './entity-access';
import { detectAllowedType } from './file-types';
import { FileReferenceRegistry } from './file-reference.registry';
import { STORAGE } from './storage/storage.token';

const SIGNED_URL_SECONDS = 300;
const THUMBNAIL_SIDE = 400;
const IMAGE_PURPOSES: ReadonlySet<string> = new Set<FilePurpose>(['image', 'reference']);

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

interface FileRow {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  entityType: string | null;
  entityId: string | null;
  purpose: string | null;
  thumbnailKey: string | null;
  uploadedById: string | null;
  storageKey: string;
  createdAt: Date;
}

const toDto = (f: FileRow): FileDto => ({
  id: f.id,
  name: f.originalName,
  mime: f.mimeType,
  size: f.sizeBytes,
  entityType: f.entityType,
  entityId: f.entityId,
  purpose: f.purpose,
  hasThumbnail: f.thumbnailKey !== null,
  createdAt: f.createdAt.toISOString(),
});

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly references: FileReferenceRegistry,
    @Inject(STORAGE) private readonly storage: StorageAdapter,
    @Inject(ENV) private readonly env: Pick<Env, 'MAX_UPLOAD_MB'>,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** Stores a file after checking its real type, size and the caller's right to attach to the target. */
  async upload(
    user: AuthUser,
    file: UploadedFile | undefined,
    dto: UploadFileDto,
  ): Promise<FileDto> {
    if (!file || file.size === 0) throw new ValidationFailedException({ file: ['is required'] });
    if (file.size > this.env.MAX_UPLOAD_MB * 1024 * 1024) {
      throw new AppException(
        'FILE_TOO_LARGE',
        413,
        `Files can be at most ${this.env.MAX_UPLOAD_MB} MB`,
      );
    }
    if (Boolean(dto.entityType) !== Boolean(dto.entityId)) {
      throw new ValidationFailedException({
        entityId: ['entityType and entityId must be given together'],
      });
    }
    if (dto.entityType) this.requirePermission(user, FILE_ENTITY_ACCESS[dto.entityType].write);

    const type = await detectAllowedType(file.buffer, dto.entityType === 'IMPORT');
    if (!type) {
      throw new ValidationFailedException({
        file: ['unsupported file type; allowed: JPEG, PNG, WebP and PDF'],
      });
    }
    if (dto.purpose && IMPORT_ONLY(type.mime) && dto.entityType !== 'IMPORT') {
      throw new ValidationFailedException({ file: ['CSV files are only accepted for imports'] });
    }
    if (dto.purpose && IMAGE_PURPOSES.has(dto.purpose) && !type.isImage) {
      throw new ValidationFailedException({ file: [`a ${dto.purpose} must be an image`] });
    }

    let thumbnail: Buffer | null = null;
    if (type.isImage) {
      try {
        thumbnail = await sharp(file.buffer)
          .rotate()
          .resize({
            width: THUMBNAIL_SIDE,
            height: THUMBNAIL_SIDE,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: 80 })
          .toBuffer();
      } catch {
        throw new ValidationFailedException({ file: ['is not a valid image'] });
      }
    }

    const now = new Date();
    const folder = `ws/${user.workspaceId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const id = randomUUID();
    const storageKey = `${folder}/${id}.${type.ext}`;
    const thumbnailKey = thumbnail ? `${folder}/${id}.thumb.webp` : null;

    await this.storage.put(storageKey, file.buffer, type.mime);
    if (thumbnail && thumbnailKey) await this.storage.put(thumbnailKey, thumbnail, 'image/webp');

    try {
      const row = await this.prisma.scoped.$transaction(async (tx) => {
        const created = await tx.fileAsset.create({
          data: {
            workspaceId: user.workspaceId,
            storageKey,
            thumbnailKey,
            originalName: sanitizeName(file.originalname),
            mimeType: type.mime,
            sizeBytes: file.size,
            entityType: dto.entityType ?? null,
            entityId: dto.entityId ?? null,
            purpose: dto.purpose ?? null,
            uploadedById: user.userId,
          },
        });
        await this.audit.record(tx, {
          action: 'file.upload',
          entityType: 'FileAsset',
          entityId: created.id,
          after: {
            name: created.originalName,
            mime: created.mimeType,
            size: created.sizeBytes,
            entityType: created.entityType,
            entityId: created.entityId,
          },
        });
        return created;
      });
      return toDto(row);
    } catch (err) {
      await this.discard([storageKey, thumbnailKey]); // never leave an object nobody can find
      throw err;
    }
  }

  /**
   * Keeps a file that arrived from a provider (a customer's photo or PDF) in the workspace. The
   * same allow-list and size limit apply as to uploads; anything else returns null and the caller
   * keeps the message without the file.
   */
  async storeInbound(
    workspaceId: string,
    file: { buffer: Buffer; name?: string },
  ): Promise<FileDto | null> {
    if (file.buffer.length === 0 || file.buffer.length > this.env.MAX_UPLOAD_MB * 1024 * 1024) {
      return null;
    }
    const type = await detectAllowedType(file.buffer, false);
    if (!type) return null;
    const now = new Date();
    const folder = `ws/${workspaceId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const storageKey = `${folder}/${randomUUID()}.${type.ext}`;
    await this.storage.put(storageKey, file.buffer, type.mime);
    try {
      const row = await this.prisma.scoped.fileAsset.create({
        data: {
          workspaceId,
          storageKey,
          originalName: sanitizeName(file.name ?? `received.${type.ext}`),
          mimeType: type.mime,
          sizeBytes: file.buffer.length,
          purpose: 'MESSAGE_ATTACHMENT',
        },
      });
      return toDto(row);
    } catch (err) {
      await this.discard([storageKey]);
      throw err;
    }
  }

  /** The bytes of a file of this workspace, for documents the server renders itself (no user check). */
  async readBytes(id: string): Promise<Buffer | null> {
    const file = await this.prisma.scoped.fileAsset.findFirst({ where: { id } });
    return file ? this.storage.get(file.storageKey) : null;
  }

  /** A signed URL valid for five minutes, after the tenant and permission check (Requirement 34.4). */
  async urlFor(user: AuthUser, id: string): Promise<FileUrlDto> {
    const file = await this.find(id);
    if (file.entityType) {
      this.requirePermission(user, FILE_ENTITY_ACCESS[file.entityType as FileEntityType].read);
    } else if (file.uploadedById !== user.userId) {
      throw new NotFoundAppException(); // an unattached file is private to whoever uploaded it
    }
    const [url, thumbnailUrl] = await Promise.all([
      this.storage.getSignedUrl(file.storageKey, SIGNED_URL_SECONDS),
      file.thumbnailKey
        ? this.storage.getSignedUrl(file.thumbnailKey, SIGNED_URL_SECONDS)
        : Promise.resolve(null),
    ]);
    return {
      url,
      thumbnailUrl,
      expiresAt: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString(),
    };
  }

  /** Removes a file unless an issued document or a message uses it (Requirement 34.8). */
  async remove(user: AuthUser, id: string): Promise<void> {
    const file = await this.find(id);
    const mayDelete =
      file.uploadedById === user.userId ||
      (file.entityType !== null &&
        user.permissions.includes(FILE_ENTITY_ACCESS[file.entityType as FileEntityType].write));
    if (!mayDelete) throw new AppException('PERMISSION_DENIED', 403, 'You cannot delete this file');
    if (file.entityType === 'MESSAGE' || (await this.references.isReferenced(file.id))) {
      throw new AppException(
        'FILE_IN_USE',
        409,
        'This file is used by an issued document or a message',
      );
    }
    await this.prisma.scoped.$transaction(async (tx) => {
      await tx.fileAsset.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'file.delete',
        entityType: 'FileAsset',
        entityId: id,
        before: { name: file.originalName, entityType: file.entityType, entityId: file.entityId },
      });
    });
    // Copies of the file (on an order made from a quotation) share the stored object.
    const shared = await this.prisma.scoped.fileAsset.count({
      where: {
        OR: [
          { storageKey: file.storageKey },
          ...(file.thumbnailKey ? [{ thumbnailKey: file.thumbnailKey }] : []),
        ],
      },
    });
    if (shared === 0) await this.discard([file.storageKey, file.thumbnailKey]);
  }

  // ── For the modules that own the records files are attached to ───────────

  /** Links an uploaded file to a record the calling module has already verified. */
  async attach(
    fileId: string,
    link: { entityType: FileEntityType; entityId: string; purpose?: FilePurpose },
  ): Promise<FileDto> {
    const file = await this.find(fileId);
    if (
      file.entityType &&
      (file.entityType !== link.entityType || file.entityId !== link.entityId)
    ) {
      throw new ValidationFailedException({ fileId: ['is already attached to another record'] });
    }
    const updated = await this.prisma.scoped.fileAsset.update({
      where: { id: fileId },
      data: {
        entityType: link.entityType,
        entityId: link.entityId,
        purpose: link.purpose ?? file.purpose,
      },
    });
    return toDto(updated);
  }

  /**
   * Gives a record the same attachments another record has (for example an order gets its
   * quotation's reference images). The stored objects are shared, not duplicated; a stored object
   * is deleted only when the last file row pointing at it goes.
   */
  async copyAttachments(
    from: { entityType: FileEntityType; entityId: string },
    to: { entityType: FileEntityType; entityId: string },
    tx?: Parameters<Parameters<PrismaService['scoped']['$transaction']>[0]>[0],
  ): Promise<number> {
    const db = tx ?? this.prisma.scoped;
    const files = await db.fileAsset.findMany({
      where: { ...from, entityId: from.entityId },
      orderBy: { createdAt: 'asc' },
    });
    for (const file of files) {
      await db.fileAsset.create({
        data: {
          workspaceId: file.workspaceId,
          storageKey: file.storageKey,
          thumbnailKey: file.thumbnailKey,
          originalName: file.originalName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          entityType: to.entityType,
          entityId: to.entityId,
          purpose: file.purpose,
          uploadedById: file.uploadedById,
        },
      });
    }
    return files.length;
  }

  async listForEntity(entityType: FileEntityType, entityId: string): Promise<FileDto[]> {
    const rows = await this.prisma.scoped.fileAsset.findMany({
      where: { entityType, entityId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDto);
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async find(id: string): Promise<FileRow> {
    const file = await this.prisma.scoped.fileAsset.findFirst({ where: { id } });
    if (!file) throw new NotFoundAppException(); // also the answer for another workspace's file
    return file;
  }

  private requirePermission(user: AuthUser, permission: Permission): void {
    if (!user.permissions.includes(permission)) {
      throw new AppException('PERMISSION_DENIED', 403, 'You do not have permission to do this');
    }
  }

  private async discard(keys: Array<string | null>): Promise<void> {
    for (const key of keys) {
      if (!key) continue;
      try {
        await this.storage.delete(key);
      } catch (err) {
        this.logger.error({ err, key }, 'could not delete a stored object');
      }
    }
  }
}

const IMPORT_ONLY = (mime: string): boolean => mime === 'text/csv';

/** Keeps the name for display only: no paths, no control characters, bounded length. */
export function sanitizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const visible = [...base].filter((ch) => {
    const code = ch.charCodeAt(0);
    return code > 0x1f && code !== 0x7f;
  });
  return visible.join('').trim().slice(0, 200) || 'file';
}
