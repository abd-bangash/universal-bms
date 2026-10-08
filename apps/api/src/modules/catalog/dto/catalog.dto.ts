import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsDecimalString } from '../../../common/money';
import { PageQueryDto } from '../../../common/pagination/pagination';

// ── categories and brands ─────────────────────────────────────────────────────────────────

export class CreateCategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdateCategoryDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateBrandDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
}

export class UpdateBrandDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

// ── variants ──────────────────────────────────────────────────────────────────────────────

const VARIANT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export class VariantInputDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) sku?: string;
  @IsOptional() @IsString() @MaxLength(60) barcode?: string | null;
  @IsOptional() @IsString() @MaxLength(120) name?: string | null;
  @IsOptional() @IsDecimalString() priceOverride?: string | null;
  @IsOptional() @IsDecimalString() costOverride?: string | null;
  @IsOptional() @IsDecimalString() weight?: string | null;
  @IsOptional() @IsDecimalString() minStockLevel?: string | null;
  @IsOptional() @IsDecimalString() maxStockLevel?: string | null;
  @IsOptional() @IsIn(VARIANT_STATUSES) status?: (typeof VARIANT_STATUSES)[number];
  @IsOptional() customFields?: Record<string, unknown>;
}

export class UpdateVariantDto extends VariantInputDto {}

export class GenerateAxisDto {
  /** Key of a variant-axis Field_Definition (entity type VARIANT). */
  @IsString() @IsNotEmpty() key!: string;
  /** A subset of the field's option keys; all options when omitted. */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) optionKeys?: string[];
}

export class GenerateVariantsDto {
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => GenerateAxisDto)
  axes!: GenerateAxisDto[];
}

// ── products ──────────────────────────────────────────────────────────────────────────────

const PRODUCT_TYPES = ['STOCKABLE', 'NON_STOCKABLE', 'SERVICE'] as const; // bundles arrive in Release 3
const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE'] as const; // ARCHIVED only through the archive action
const TRACKING = ['NONE', 'BATCH', 'SERIAL'] as const;

class ProductFields {
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsString() categoryId?: string | null;
  @IsOptional() @IsString() brandId?: string | null;
  @IsOptional() @IsIn(PRODUCT_TYPES) type?: (typeof PRODUCT_TYPES)[number];
  @IsOptional() @IsIn(PRODUCT_STATUSES) status?: (typeof PRODUCT_STATUSES)[number];
  @IsOptional() @IsBoolean() madeToOrder?: boolean;
  @IsOptional() @IsEnum(TRACKING) tracking?: (typeof TRACKING)[number];
  @IsOptional() @IsString() baseUnitId?: string | null;
  @IsOptional() @IsString() saleUnitId?: string | null;
  @IsOptional() @IsString() purchaseUnitId?: string | null;
  @IsOptional() @IsDecimalString() saleUnitFactor?: string;
  @IsOptional() @IsDecimalString() purchaseUnitFactor?: string;
  @IsOptional() @IsDecimalString() costPrice?: string | null;
  @IsOptional() @IsString() taxClassId?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  tags?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  aliases?: string[];
  @IsOptional() @IsBoolean() visibleInPos?: boolean;
  @IsOptional() @IsBoolean() visibleToAi?: boolean;
  @IsOptional() customFields?: Record<string, unknown>;
}

export class CreateProductDto extends ProductFields {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) code?: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsDecimalString() basePrice!: string;
  /** Without variants, one default variant is created from the product code. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => VariantInputDto)
  variants?: VariantInputDto[];
}

export class UpdateProductDto extends ProductFields {
  /** The version the client last read; a stale one is rejected with 409 (Requirement 54.2). */
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) code?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
  @IsOptional() @IsDecimalString() basePrice?: string;
}

export class ListProductsQuery extends PageQueryDto {
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() brandId?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'ARCHIVED']) status?:
    'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  @IsOptional() @IsEnum(['STOCKABLE', 'NON_STOCKABLE', 'SERVICE', 'BUNDLE']) type?: string;
}

export class ArchiveProductDto {
  @IsOptional() @IsInt() @Min(1) version?: number;
}

// ── images ────────────────────────────────────────────────────────────────────────────────

export class AttachImageDto {
  @IsString() @IsNotEmpty() fileId!: string;
  @IsOptional() @IsString() variantId?: string | null;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class ReorderImagesDto {
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) imageIds!: string[];
}

// ── lookup ────────────────────────────────────────────────────────────────────────────────

export class LookupQuery {
  @IsString() @IsNotEmpty() @MaxLength(100) code!: string;
}

export class SearchVariantsQuery {
  @IsString() @IsNotEmpty() @MaxLength(100) q!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  /** Only variants of products visible in that channel. */
  @IsOptional() @IsIn(['pos', 'ai']) channel?: 'pos' | 'ai';
}
