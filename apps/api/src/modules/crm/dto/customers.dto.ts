import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/pagination';

export class AddressDto {
  @IsOptional() @IsString() @MaxLength(200) line1?: string;
  @IsOptional() @IsString() @MaxLength(200) line2?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) state?: string;
  @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  @IsOptional() @IsString() @MaxLength(100) country?: string;
}

const CHANNELS = ['WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'PHONE', 'EMAIL', 'SMS'] as const;

class CustomerFields {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  phones?: string[];
  @IsOptional() @IsEmail() @MaxLength(254) email?: string | null;
  @IsOptional() @ValidateNested() @Type(() => AddressDto) billingAddress?: AddressDto | null;
  @IsOptional() @ValidateNested() @Type(() => AddressDto) shippingAddress?: AddressDto | null;
  @IsOptional() @IsIn(CHANNELS) preferredChannel?: (typeof CHANNELS)[number] | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
  @IsOptional() @IsString() @MaxLength(60) source?: string | null;
  @IsOptional() @IsString() @MaxLength(60) channel?: string | null;
  @IsOptional() @IsString() @MaxLength(120) campaign?: string | null;
  @IsOptional() @IsString() assignedToId?: string | null;
  @IsOptional() @IsString() priceListId?: string | null;
  @IsOptional() customFields?: Record<string, unknown>;
  /** The client has seen the possible duplicates and wants to save anyway (Requirement 8.2). */
  @IsOptional() @IsBoolean() confirmDuplicate?: boolean;
}

export class CreateCustomerDto extends CustomerFields {
  @IsString() @IsNotEmpty() @MaxLength(200) fullName!: string;
}

export class UpdateCustomerDto extends CustomerFields {
  /** The version the client last read; a stale one is rejected with 409 (Requirement 54.2). */
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) fullName?: string;
}

export class ListCustomersQuery extends PageQueryDto {
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() tag?: string;
  @IsOptional() @IsString() assignedToId?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsIn(['ACTIVE', 'ARCHIVED']) status?: 'ACTIVE' | 'ARCHIVED';
}

export class TimelineQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
  @IsOptional() @IsString() cursor?: string;
}
