import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsDecimalString } from '../../common/money';

export class DiscountDto {
  @IsIn(['AMOUNT', 'PERCENT']) type!: 'AMOUNT' | 'PERCENT';
  @IsDecimalString() value!: string;
}

/** A line as clients send it, for pricing previews and for quotation, order and POS lines. */
export class LineInputDto {
  /** `CATALOG` (a variant) or `CUSTOM` (made to order or free text). Defaults to CATALOG with a variant. */
  @IsOptional() @IsIn(['CATALOG', 'CUSTOM']) kind?: 'CATALOG' | 'CUSTOM';
  @IsOptional() @IsString() variantId?: string;
  /** Required for custom lines. */
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsDecimalString() quantity!: string;
  /** Replaces the catalog price; needs `order:price_override` and is audited (Requirement 35.9). Required for custom lines. */
  @IsOptional() @IsDecimalString() unitPrice?: string;
  @IsOptional() @ValidateNested() @Type(() => DiscountDto) discount?: DiscountDto | null;
  /** Custom lines only; catalog lines take the product's tax class. */
  @IsOptional() @IsString() taxClassId?: string | null;
  @IsOptional() @IsString() unitId?: string | null;
  @IsOptional() customFields?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
}

export class PricingPreviewDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LineInputDto)
  lines!: LineInputDto[];
  @IsOptional() @ValidateNested() @Type(() => DiscountDto) orderDiscount?: DiscountDto | null;
  @IsOptional() @IsString() customerId?: string;
  /** The customer pays in cash: apply the workspace's cash rounding (Requirement 35.7). */
  @IsOptional() @IsBoolean() cash?: boolean;
}
