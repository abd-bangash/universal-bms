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

export const ORDER_TYPES = ['STANDARD', 'CUSTOM'] as const;
export const ORDER_SOURCES = ['MESSAGING', 'SOCIAL', 'STORE', 'WEBSITE', 'MANUAL'] as const;
export const FULFILMENT_METHODS = ['PICKUP', 'DELIVERY'] as const;
export const ORDER_PAYMENT_STATUSES = [
  'UNPAID',
  'DEPOSIT_PAID',
  'PARTIALLY_PAID',
  'PAID',
  'OVERPAID',
  'REFUNDED',
] as const;

export class FulfilmentDto {
  @IsOptional() @IsIn(FULFILMENT_METHODS) method?: (typeof FULFILMENT_METHODS)[number] | null;
  @IsOptional() deliveryAddress?: Record<string, unknown> | null;
  @IsOptional() @IsDateString() scheduledAt?: string | null;
  @IsOptional() @IsDateString() deliveredAt?: string | null;
  @IsOptional() @IsString() deliveredById?: string | null;
  @IsOptional() @IsString() @MaxLength(200) receiverName?: string | null;
  /** A file already uploaded for this order (proof of delivery). */
  @IsOptional() @IsString() proofFileId?: string | null;
}

class OrderFields extends FulfilmentDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LineInputDto)
  lines?: LineInputDto[];
  @IsOptional() @ValidateNested() @Type(() => DiscountDto) orderDiscount?: DiscountDto | null;
  @IsOptional() @IsIn(ORDER_TYPES) orderType?: (typeof ORDER_TYPES)[number];
  @IsOptional() @IsIn(ORDER_SOURCES) source?: (typeof ORDER_SOURCES)[number];
  @IsOptional() @IsString() @MaxLength(60) channel?: string | null;
  @IsOptional() @IsString() @MaxLength(120) campaign?: string | null;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() assignedToId?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) internalNotes?: string | null;
  @IsOptional() customFields?: Record<string, unknown>;
}

export class CreateOrderDto extends OrderFields {
  @IsString() @IsNotEmpty() customerId!: string;
  @IsOptional() @IsString() leadId?: string;
}

export class UpdateOrderDto extends OrderFields {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() customerId?: string;
}

export class ChangeOrderStatusDto {
  @IsString() @IsNotEmpty() status!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  /** Required when cancelling. */
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class ListOrdersQuery extends PageQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsIn(ORDER_PAYMENT_STATUSES) paymentStatus?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() assignedToId?: string;
  @IsOptional() @IsIn([...ORDER_TYPES, 'POS']) orderType?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
