import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FileReferenceRegistry } from '../files/file-reference.registry';
import { FilesService } from '../files/files.service';
import { toImageDto, type ImageDto } from './catalog.support';
import type { AttachImageDto, ReorderImagesDto } from './dto/catalog.dto';
import { archivedError } from './products.service';

const MAX_IMAGES = 20;

@Injectable()
export class ProductImagesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly references: FileReferenceRegistry,
  ) {}

  onModuleInit(): void {
    // A file shown on a product cannot be deleted from under it.
    this.references.register('product-image', async (fileId) => {
      return (await this.prisma.scoped.productImage.count({ where: { fileId } })) > 0;
    });
  }

  async list(productId: string): Promise<ImageDto[]> {
    await this.product(productId);
    const rows = await this.prisma.scoped.productImage.findMany({
      where: { productId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toImageDto);
  }

  async attach(user: AuthUser, productId: string, dto: AttachImageDto): Promise<ImageDto> {
    const product = await this.product(productId);
    if (product.status === 'ARCHIVED') throw archivedError();

    const file = await this.prisma.scoped.fileAsset.findFirst({ where: { id: dto.fileId } });
    if (!file) throw new ValidationFailedException({ fileId: ['does not exist'] });
    if (!file.mimeType.startsWith('image/')) {
      throw new ValidationFailedException({ fileId: ['must be an image'] });
    }
    const foreign =
      file.entityType !== null && !(file.entityType === 'PRODUCT' && file.entityId === productId);
    if (foreign || (file.entityType === null && file.uploadedById !== user.userId)) {
      throw new ValidationFailedException({ fileId: ['cannot be used on this product'] });
    }
    if (dto.variantId) {
      const variant = await this.prisma.scoped.productVariant.findFirst({
        where: { id: dto.variantId, productId },
      });
      if (!variant)
        throw new ValidationFailedException({ variantId: ['does not belong to this product'] });
    }

    const created = await this.prisma.scoped.$transaction(async (tx) => {
      const existing = await tx.productImage.findMany({ where: { productId } });
      if (existing.length >= MAX_IMAGES) {
        throw new ValidationFailedException({
          fileId: [`a product can have at most ${MAX_IMAGES} images`],
        });
      }
      if (existing.some((i) => i.fileId === dto.fileId)) {
        throw new AppException('POSSIBLE_DUPLICATE', 409, 'This image is already attached');
      }
      const makePrimary = dto.isPrimary === true || existing.length === 0;
      if (makePrimary) {
        await tx.productImage.updateMany({ where: { productId }, data: { isPrimary: false } });
      }
      if (file.entityType === null) {
        // Attaching makes the file visible to anyone who may view the product.
        await tx.fileAsset.update({
          where: { id: file.id },
          data: { entityType: 'PRODUCT', entityId: productId, purpose: 'image' },
        });
      }
      const row = await tx.productImage.create({
        data: {
          workspaceId: user.workspaceId,
          productId,
          variantId: dto.variantId ?? null,
          fileId: dto.fileId,
          sortOrder: existing.reduce((max, i) => Math.max(max, i.sortOrder), -1) + 1,
          isPrimary: makePrimary,
        },
      });
      await tx.product.update({ where: { id: productId }, data: { version: { increment: 1 } } });
      await this.audit.record(tx, {
        action: 'product.image_add',
        entityType: 'Product',
        entityId: productId,
        after: { imageId: row.id, fileId: row.fileId, isPrimary: row.isPrimary },
      });
      return row;
    });
    return toImageDto(created);
  }

  async reorder(productId: string, dto: ReorderImagesDto): Promise<ImageDto[]> {
    await this.product(productId);
    return this.prisma.scoped.$transaction(async (tx) => {
      const existing = await tx.productImage.findMany({ where: { productId } });
      const ids = new Set(existing.map((i) => i.id));
      if (
        dto.imageIds.length !== ids.size ||
        new Set(dto.imageIds).size !== ids.size ||
        dto.imageIds.some((id) => !ids.has(id))
      ) {
        throw new ValidationFailedException({
          imageIds: ['must list every image of the product once'],
        });
      }
      for (const [index, id] of dto.imageIds.entries()) {
        await tx.productImage.update({ where: { id }, data: { sortOrder: index } });
      }
      await this.audit.record(tx, {
        action: 'product.image_reorder',
        entityType: 'Product',
        entityId: productId,
        after: { order: dto.imageIds },
      });
      return (
        await tx.productImage.findMany({ where: { productId }, orderBy: { sortOrder: 'asc' } })
      ).map(toImageDto);
    });
  }

  async setPrimary(imageId: string): Promise<ImageDto> {
    const image = await this.image(imageId);
    return this.prisma.scoped.$transaction(async (tx) => {
      await tx.productImage.updateMany({
        where: { productId: image.productId },
        data: { isPrimary: false },
      });
      const row = await tx.productImage.update({
        where: { id: imageId },
        data: { isPrimary: true },
      });
      await this.audit.record(tx, {
        action: 'product.image_primary',
        entityType: 'Product',
        entityId: image.productId,
        after: { imageId },
      });
      return toImageDto(row);
    });
  }

  async remove(user: AuthUser, imageId: string): Promise<void> {
    const image = await this.image(imageId);
    await this.prisma.scoped.$transaction(async (tx) => {
      await tx.productImage.delete({ where: { id: imageId } });
      if (image.isPrimary) {
        const next = await tx.productImage.findFirst({
          where: { productId: image.productId },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        });
        if (next)
          await tx.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
      await tx.product.update({
        where: { id: image.productId },
        data: { version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'product.image_remove',
        entityType: 'Product',
        entityId: image.productId,
        before: { imageId, fileId: image.fileId },
      });
    });
    // The file itself goes too, unless something else still uses it.
    await this.files.remove(user, image.fileId).catch((err: unknown) => {
      if (!(err instanceof AppException)) throw err;
    });
  }

  private async product(id: string) {
    const product = await this.prisma.scoped.product.findFirst({ where: { id } });
    if (!product) throw new NotFoundAppException();
    return product;
  }

  private async image(id: string) {
    const image = await this.prisma.scoped.productImage.findFirst({ where: { id } });
    if (!image) throw new NotFoundAppException();
    return image;
  }
}
