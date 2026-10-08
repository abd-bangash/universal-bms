import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsDecimalString } from '../../../common/money';
import { PageQueryDto } from '../../../common/pagination/pagination';

export const QUANTITY_UNITS = ['BASE', 'SALE', 'PURCHASE'] as const;

export class OpeningStockLineDto {
  @IsString() @IsNotEmpty() variantId!: string;
  @IsDecimalString() quantity!: string;
  /** Which unit the quantity is in; the base unit unless stated. */
  @IsOptional() @IsIn(QUANTITY_UNITS) unit?: (typeof QUANTITY_UNITS)[number];
  @IsDecimalString() unitCost!: string;
}

export class OpeningStockDto {
  /** The default location when left out. */
  @IsOptional() @IsString() locationId?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => OpeningStockLineDto)
  lines!: OpeningStockLineDto[];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class AdjustStockDto {
  @IsOptional() @IsString() locationId?: string;
  @IsString() @IsNotEmpty() variantId!: string;
  @IsIn(['IN', 'OUT']) direction!: 'IN' | 'OUT';
  @IsDecimalString() quantity!: string;
  @IsOptional() @IsIn(QUANTITY_UNITS) unit?: (typeof QUANTITY_UNITS)[number];
  /** Every adjustment says why, from the workspace's list (Requirement 37.2). */
  @IsString() @IsNotEmpty() reasonId!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  /** For stock coming in at a known cost. */
  @IsOptional() @IsDecimalString() unitCost?: string;
}

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true';

export class ListStockQuery extends PageQueryDto {
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() categoryId?: string;
  /** Only variants below their minimum level. */
  @IsOptional() @Transform(toBool) @IsBoolean() low?: boolean;
  /** Only variants above their maximum level. */
  @IsOptional() @Transform(toBool) @IsBoolean() over?: boolean;
}

export class ListMovementsQuery extends PageQueryDto {
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() referenceType?: string;
  @IsOptional() @IsString() referenceId?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class CreateLocationDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @IsOptional() @IsIn(['STORE', 'WAREHOUSE', 'SHOWROOM', 'DAMAGED']) type?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateLocationDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsIn(['STORE', 'WAREHOUSE', 'SHOWROOM', 'DAMAGED']) type?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateReasonDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
}

export class UpdateReasonDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ListFlagQuery {
  @IsOptional() @Transform(toBool) @IsBoolean() includeInactive?: boolean;
}
