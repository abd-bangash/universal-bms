import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const FIELD_ENTITIES = [
  'PRODUCT',
  'VARIANT',
  'ORDER_ITEM',
  'QUOTATION_ITEM',
  'CUSTOMER',
  'LEAD',
  'ORDER',
  'QUOTATION',
  'SUPPLIER',
  'PURCHASE_ORDER',
  'EXPENSE',
] as const;
export type FieldEntityName = (typeof FIELD_ENTITIES)[number];

export const FIELD_TYPES = [
  'TEXT',
  'NUMBER',
  'DATE',
  'BOOLEAN',
  'DROPDOWN',
  'MULTI_SELECT',
  'MEASUREMENT',
  'CURRENCY',
  'IMAGE',
  'REFERENCE',
] as const;

export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const DIMENSIONS = ['length', 'area', 'weight', 'volume'] as const;

export class ListFieldsQuery {
  @IsEnum(FIELD_ENTITIES) entityType!: FieldEntityName;
  /** Deactivated definitions are listed only when asked for (the settings screen). */
  @IsOptional() @Type(() => Boolean) @IsBoolean() includeInactive?: boolean;
}

export class FieldOptionDto {
  @IsString() @Matches(FIELD_KEY_PATTERN) key!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) label!: string;
}

export class CreateFieldDto {
  @IsEnum(FIELD_ENTITIES) entityType!: FieldEntityName;
  @IsString() @Matches(FIELD_KEY_PATTERN) key!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) label!: string;
  @IsEnum(FIELD_TYPES) type!: (typeof FIELD_TYPES)[number];
  @IsOptional() @IsEnum(DIMENSIONS) unitDimension?: (typeof DIMENSIONS)[number];
  @IsOptional() @IsString() @MaxLength(12) defaultUnit?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldOptionDto)
  options?: FieldOptionDto[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() defaultValue?: unknown;
  @IsOptional() @IsString() categoryId?: string | null;
  @IsOptional() visibleWhen?: unknown;
  @IsOptional() @IsBoolean() isVariantAxis?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdateFieldDto {
  /** Allowed only until the key has been used on a record (Requirement 26.2). */
  @IsOptional() @IsString() @Matches(FIELD_KEY_PATTERN) key?: string;
  /** Allowed only until the field has been used on a record. */
  @IsOptional() @IsEnum(FIELD_TYPES) type?: (typeof FIELD_TYPES)[number];
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) label?: string;
  @IsOptional() @IsEnum(DIMENSIONS) unitDimension?: (typeof DIMENSIONS)[number] | null;
  @IsOptional() @IsString() @MaxLength(12) defaultUnit?: string | null;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldOptionDto)
  options?: FieldOptionDto[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() defaultValue?: unknown;
  @IsOptional() @IsString() categoryId?: string | null;
  @IsOptional() visibleWhen?: unknown;
  @IsOptional() @IsBoolean() isVariantAxis?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  /** Fields are deactivated, never deleted (Requirement 26.6). */
  @IsOptional() @IsBoolean() active?: boolean;
}
