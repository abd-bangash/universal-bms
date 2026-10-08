import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateRoleDto {
  @IsString() @IsNotEmpty() @MaxLength(60) name!: string;
  @IsArray() @ArrayUnique() @ArrayMaxSize(300) @IsString({ each: true }) permissions!: string[];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) maxDiscountPercent?: number;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) viewerModules?: string[];
}

export class UpdateRoleDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) name?: string;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(300)
  @IsString({ each: true })
  permissions?: string[];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) maxDiscountPercent?: number;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) viewerModules?: string[];
}

export class DeleteRoleQuery {
  @IsString() @IsNotEmpty() @MaxLength(100) fallbackRoleId!: string;
}
