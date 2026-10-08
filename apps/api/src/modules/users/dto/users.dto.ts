import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/pagination';

export class ListUsersQuery extends PageQueryDto {
  @IsOptional() @IsEnum(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @IsOptional() @IsString() @MaxLength(100) roleId?: string;
}

export class InviteUserDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsString({ each: true }) roleIds!: string[];
}

export class UpdateUserDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) lastName?: string;
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  @MaxLength(40)
  phone?: string | null;
  @IsOptional() @IsString() @MaxLength(100) jobTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(50) employeeCode?: string | null;
  @IsOptional() @IsISO8601() joinDate?: string | null;
  @IsOptional() @IsBoolean() isSalesperson?: boolean;
  @IsOptional() @IsString() @MaxLength(100) defaultLocationId?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  roleIds?: string[];
}

export class AcceptInvitationDto {
  @IsString() @IsNotEmpty() @MaxLength(200) token!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) password!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) firstName!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) lastName!: string;
}
