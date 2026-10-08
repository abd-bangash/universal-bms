import { Injectable } from '@nestjs/common';
import { Prisma, type Product, type ProductImage, type ProductVariant } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import { AppException, NotFoundAppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { likePattern } from './catalog.support';

/** What a document line or POS screen needs to pick a variant (no cost: pickers are for sellers). */
export interface VariantPickerDto {
  variantId: string;
  productId: string;
  productCode: string;
  productName: string;
  variantName: string | null;
  sku: string;
  barcode: string | null;
  type: string;
  tracking: string;
  madeToOrder: boolean;
  unitId: string | null;
  taxClassId: string | null;
  /** The variant's price override, else the product's base price (price lists arrive in Release 3). */
  price: string;
  /** Filled in by the inventory module once it exists (task 45); null means "not tracked here yet". */
  availableStock: string | null;
  imageFileId: string | null;
  customFields: Record<string, unknown>;
}

type Row = ProductVariant & { product: Product & { images: ProductImage[] } };

const INCLUDE = { product: { include: { images: true } } } as const;

export function toPicker(v: Row): VariantPickerDto {
  const image =
    v.product.images.find((i) => i.variantId === v.id && i.isPrimary) ??
    v.product.images.find((i) => i.isPrimary) ??
    v.product.images[0];
  return {
    variantId: v.id,
    productId: v.productId,
    productCode: v.product.code,
    productName: v.product.name,
    variantName: v.name,
    sku: v.sku,
    barcode: v.barcode,
    type: v.product.type,
    tracking: v.product.tracking,
    madeToOrder: v.product.madeToOrder,
    unitId: v.product.saleUnitId ?? v.product.baseUnitId,
    taxClassId: v.product.taxClassId,
    price: (v.priceOverride ?? v.product.basePrice).toFixed(),
    availableStock: null,
    imageFileId: image?.fileId ?? null,
    customFields: v.customFields as Record<string, unknown>,
  };
}

@Injectable()
export class VariantLookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  /** Barcode first, then SKU (design.md Catalog). Archived matches say so instead of vanishing. */
  async lookup(code: string): Promise<VariantPickerDto> {
    const text = code.trim();
    const byBarcode = await this.prisma.scoped.productVariant.findFirst({
      where: { barcode: text },
      include: INCLUDE,
    });
    const found =
      byBarcode ??
      (await this.prisma.scoped.productVariant.findFirst({
        where: { sku: { equals: text, mode: 'insensitive' } },
        include: INCLUDE,
      }));
    if (!found) throw new NotFoundAppException('No product has this barcode or SKU');
    if (found.status === 'ARCHIVED' || found.product.status === 'ARCHIVED') {
      throw new AppException('PRODUCT_ARCHIVED', 422, 'This product is archived');
    }
    return toPicker(found);
  }

  /** Name, SKU, barcode, code, variant name and aliases; exact matches first. Active items only. */
  async search(q: string, limit = 20, channel?: 'pos' | 'ai'): Promise<VariantPickerDto[]> {
    const workspaceId = this.cls.get('workspaceId');
    if (!workspaceId) throw new Error('No workspace in context');
    const text = q.trim();
    const like = likePattern(text);
    const prefix = `${text.replace(/[\\%_]/g, '\\$&')}%`;
    const channelFilter =
      channel === 'pos'
        ? Prisma.sql`AND p.visible_in_pos`
        : channel === 'ai'
          ? Prisma.sql`AND p.visible_to_ai`
          : Prisma.empty;

    const ids = await this.prisma.scoped.$queryRaw<Array<{ id: string }>>`
      SELECT v.id FROM product_variants v
      JOIN products p ON p.id = v.product_id AND p.workspace_id = v.workspace_id
      WHERE v.workspace_id = ${workspaceId}
        AND v.status = 'ACTIVE' AND p.status = 'ACTIVE' ${channelFilter}
        AND (v.sku ILIKE ${like} OR v.barcode ILIKE ${like} OR v.name ILIKE ${like}
             OR p.name ILIKE ${like} OR p.code ILIKE ${like}
             OR EXISTS (SELECT 1 FROM unnest(p.aliases) AS a WHERE a ILIKE ${like}))
      ORDER BY
        CASE WHEN lower(v.barcode) = lower(${text}) OR lower(v.sku) = lower(${text}) THEN 0
             WHEN v.sku ILIKE ${prefix} OR p.name ILIKE ${prefix} THEN 1
             ELSE 2 END,
        p.name, v.sku
      LIMIT ${limit}`;
    if (ids.length === 0) return [];

    const rows = await this.prisma.scoped.productVariant.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      include: INCLUDE,
    });
    const order = new Map(ids.map((r, i) => [r.id, i]));
    return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map(toPicker);
  }

  /**
   * Called by quotations, orders and POS when lines are added: archived products and variants are
   * refused with 422 `PRODUCT_ARCHIVED` and never partially accepted (Requirement 6.7).
   */
  async assertSellable(variantIds: readonly string[]): Promise<void> {
    const unique = [...new Set(variantIds)];
    const rows = await this.prisma.scoped.productVariant.findMany({
      where: { id: { in: unique } },
      include: { product: { select: { status: true, name: true } } },
    });
    if (rows.length !== unique.length)
      throw new NotFoundAppException('A product variant does not exist');
    const archived = rows.filter((v) => v.status === 'ARCHIVED' || v.product.status === 'ARCHIVED');
    if (archived.length > 0) {
      throw new AppException('PRODUCT_ARCHIVED', 422, 'An archived product cannot be added', {
        variantIds: archived.map((v) => v.id),
      });
    }
  }
}
