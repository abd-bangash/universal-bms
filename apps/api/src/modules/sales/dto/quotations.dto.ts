import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
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
import { DiscountDto, LineInputDto } from '../../pricing/pricing.dto';

class QuotationFields {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LineInputDto)
  lines?: LineInputDto[];
  @IsOptional() @ValidateNested() @Type(() => DiscountDto) orderDiscount?: DiscountDto | null;
  /** Defaults to today plus the workspace's quotation validity (Requirement 10.1). */
  @IsOptional() @IsDateString() validUntil?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
  @IsOptional() @IsString() @MaxLength(8000) terms?: string | null;
  @IsOptional() @IsString() @MaxLength(60) source?: string | null;
  @IsOptional() @IsString() @MaxLength(60) channel?: string | null;
  @IsOptional() @IsString() @MaxLength(120) campaign?: string | null;
  @IsOptional() @IsString() assignedToId?: string | null;
  @IsOptional() customFields?: Record<string, unknown>;
}

export class CreateQuotationDto extends QuotationFields {
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() leadId?: string;
}

export class UpdateQuotationDto extends QuotationFields {
  @IsInt() @Min(1) version!: number;
  /** A quotation can be moved to another customer while it is a draft or sent. */
  @IsOptional() @IsString() customerId?: string;
}

export class SendQuotationDto {
  @IsOptional() @IsIn(['MANUAL', 'CONVERSATION']) via?: 'MANUAL' | 'CONVERSATION';
}

export class AcceptQuotationDto {
  /** How the customer said yes (Requirement 39.4). */
  @IsIn(['IN_PERSON', 'MESSAGE', 'PHONE']) via!: 'IN_PERSON' | 'MESSAGE' | 'PHONE';
  /** An optional attachment: a signed copy, a screenshot of the message. */
  @IsOptional() @IsString() fileId?: string;
}

export class RejectQuotationDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string;
}

export class ListQuotationsQuery extends PageQueryDto {
  @IsOptional()
  @IsIn(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED'])
  status?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() leadId?: string;
}
