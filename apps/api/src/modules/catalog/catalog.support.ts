import { Prisma } from '@prisma/client';
import type { Brand, Category, Product, ProductImage, ProductVariant } from '@prisma/client';
import { AppException, ValidationFailedException } from '../../common/errors/app.exception';
import { isDecimalString, toDecimal } from '../../common/money';

export interface CategoryDto {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  active: boolean;
}
export interface CategoryNode extends CategoryDto {
  children: CategoryNode[];
}
export interface BrandDto {
  id: string;
  name: string;
  active: boolean;
}
export interface ImageDto {
  id: string;
  fileId: string;
  variantId: string | null;
  sortOrder: number;
  isPrimary: boolean;
}
export interface VariantDto {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  name: string | null;
  isDefault: boolean;
  priceOverride: string | null;
  costOverride?: string | null;
  weight: string | null;
  minStockLevel: string | null;
  maxStockLevel: string | null;
  status: string;
  customFields: Record<string, unknown>;
}
export interface ProductDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  brandId: string | null;
  type: string;
  status: string;
  madeToOrder: boolean;
  tracking: string;
  baseUnitId: string | null;
  saleUnitId: string | null;
  purchaseUnitId: string | null;
  saleUnitFactor: string;
  purchaseUnitFactor: string;
  basePrice: string;
  costPrice?: string | null;
  taxClassId: string | null;
  tags: string[];
  aliases: string[];
  visibleInPos: boolean;
  visibleToAi: boolean;
  customFields: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
  variants?: VariantDto[];
  images?: ImageDto[];
}

type Dec = { toFixed(): string } | null;
const str = (d: Dec): string | null => (d === null ? null : d.toFixed());

export const toCategoryDto = (c: Category): CategoryDto => ({
  id: c.id,
  name: c.name,
  parentId: c.parentId,
  sortOrder: c.sortOrder,
  active: c.active,
});

export const toBrandDto = (b: Brand): BrandDto => ({ id: b.id, name: b.name, active: b.active });

export const toImageDto = (i: ProductImage): ImageDto => ({
  id: i.id,
  fileId: i.fileId,
  variantId: i.variantId,
  sortOrder: i.sortOrder,
  isPrimary: i.isPrimary,
});

/** Cost fields are omitted, not zeroed, without `product:view_cost` (design.md Catalog). */
export function toVariantDto(v: ProductVariant, canViewCost: boolean): VariantDto {
  return {
    id: v.id,
    productId: v.productId,
    sku: v.sku,
    barcode: v.barcode,
    name: v.name,
    isDefault: v.isDefault,
    priceOverride: str(v.priceOverride),
    ...(canViewCost ? { costOverride: str(v.costOverride) } : {}),
    weight: str(v.weight),
    minStockLevel: str(v.minStockLevel),
    maxStockLevel: str(v.maxStockLevel),
    status: v.status,
    customFields: v.customFields as Record<string, unknown>,
  };
}

export function toProductDto(
  p: Product & { variants?: ProductVariant[]; images?: ProductImage[] },
  canViewCost: boolean,
): ProductDto {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    categoryId: p.categoryId,
    brandId: p.brandId,
    type: p.type,
    status: p.status,
    madeToOrder: p.madeToOrder,
    tracking: p.tracking,
    baseUnitId: p.baseUnitId,
    saleUnitId: p.saleUnitId,
    purchaseUnitId: p.purchaseUnitId,
    saleUnitFactor: p.saleUnitFactor.toFixed(),
    purchaseUnitFactor: p.purchaseUnitFactor.toFixed(),
    basePrice: p.basePrice.toFixed(),
    ...(canViewCost ? { costPrice: str(p.costPrice) } : {}),
    taxClassId: p.taxClassId,
    tags: p.tags,
    aliases: p.aliases,
    visibleInPos: p.visibleInPos,
    visibleToAi: p.visibleToAi,
    customFields: p.customFields as Record<string, unknown>,
    version: p.version,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    ...(p.variants
      ? {
          variants: [...p.variants]
            .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.sku.localeCompare(b.sku))
            .map((v) => toVariantDto(v, canViewCost)),
        }
      : {}),
    ...(p.images
      ? { images: [...p.images].sort((a, b) => a.sortOrder - b.sortOrder).map(toImageDto) }
      : {}),
  };
}

/** Amounts and quantities that must not be negative (money is a decimal string, never a number). */
export function nonNegative(
  details: Record<string, string[]>,
  field: string,
  value: unknown,
): void {
  if (value === undefined || value === null) return;
  if (!isDecimalString(value) || toDecimal(value as string).isNegative()) {
    details[field] = ['must be zero or more'];
  }
}

/** The columns named by a unique-constraint failure, or null when the error is something else. */
export function uniqueColumns(err: unknown): string[] | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return null;
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.map(String);
  return typeof target === 'string' ? [target] : [];
}

/** A unique-constraint failure becomes a 409 naming the field (SKU, barcode, code, name). */
export function conflictFrom(
  err: unknown,
  fieldByColumn: Record<string, string>,
): AppException | null {
  const columns = uniqueColumns(err);
  if (columns === null) return null;
  for (const [column, field] of Object.entries(fieldByColumn)) {
    if (
      columns.some((c) => c === column || c.includes(`_${column}_`) || c.endsWith(`_${column}_key`))
    ) {
      return new AppException('POSSIBLE_DUPLICATE', 409, `${field} is already in use`, {
        [field]: ['is already in use in this workspace'],
      });
    }
  }
  return new AppException('POSSIBLE_DUPLICATE', 409, 'A record with these values already exists');
}

export const PRODUCT_COLUMNS = { code: 'code', sku: 'sku', barcode: 'barcode' } as const;

export const cleanList = (items: string[] | undefined): string[] | undefined =>
  items === undefined
    ? undefined
    : [...new Set(items.map((i) => i.trim()).filter((i) => i !== ''))];

export function requireDetails(details: Record<string, string[]>): void {
  if (Object.keys(details).length > 0) throw new ValidationFailedException(details);
}

/** Escapes LIKE wildcards so a search for "50%" is literal. */
export const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, '\\$&')}%`;
