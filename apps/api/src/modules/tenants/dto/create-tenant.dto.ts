import { Type } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class OwnerDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) firstName!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) lastName!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) password!: string;
}

export class CreateTenantDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsString() @Matches(/^[a-z][a-z0-9_]*$/) industryProfile!: string;
  @ValidateNested() @Type(() => OwnerDto) owner!: OwnerDto;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
}
