import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsDecimalString } from '../../../common/money';

const DIMENSIONS = ['count', 'weight', 'length', 'area', 'volume', 'time'] as const;

export class CreateUnitDto {
  @IsString() @IsNotEmpty() @MaxLength(60) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(12) symbol!: string;
  @IsEnum(DIMENSIONS) dimension!: (typeof DIMENSIONS)[number];
  /** Factor to the base unit of the dimension, as a decimal string (the base unit itself is "1"). */
  @IsDecimalString() toBase!: string;
}

export class UpdateUnitDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) name?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(12) symbol?: string;
}

export class CreateTaxClassDto {
  @IsString() @IsNotEmpty() @MaxLength(60) name!: string;
  /** A fraction such as "0.1700" for 17 percent. */
  @IsDecimalString() rate!: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateTaxClassDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) name?: string;
  @IsOptional() @IsDecimalString() rate?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ProfileKeyParam {
  @IsString() @Matches(/^[a-z][a-z0-9_]*$/) key!: string;
}

export class CreateLostReasonDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateLostReasonDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ListLostReasonsQuery {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;
}
