import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsDecimalString } from '../../../common/money';
import { PageQueryDto } from '../../../common/pagination/pagination';

/** What staff can record. A refund is made in Release 3; applied credit has its own endpoint. */
export const RECORDABLE_TYPES = ['ORDER_PAYMENT', 'DEPOSIT', 'ADVANCE'] as const;

export class RecordPaymentDto {
  @IsIn(RECORDABLE_TYPES) type!: (typeof RECORDABLE_TYPES)[number];
  /** Required for an order payment or deposit. */
  @IsOptional() @IsString() orderId?: string;
  /** Required for an advance (money paid before there is an order). */
  @IsOptional() @IsString() customerId?: string;
  @IsString() @IsNotEmpty() paymentMethodId!: string;
  @IsDecimalString() amount!: string;
  @IsOptional() @IsDateString() paidAt?: string;
  @IsOptional() @IsString() @MaxLength(120) referenceNumber?: string;
  /** An uploaded file showing the payment (a transfer screenshot, a slip). */
  @IsOptional() @IsString() proofFileId?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class RejectPaymentDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string;
}

export class VoidPaymentDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string;
}

export class ApplyCreditDto {
  @IsString() @IsNotEmpty() orderId!: string;
  @IsDecimalString() amount!: string;
}

export class ListPaymentsQuery extends PageQueryDto {
  @IsOptional() @IsIn(['PENDING_VERIFICATION', 'CONFIRMED', 'REJECTED', 'VOIDED']) status?: string;
  @IsOptional()
  @IsIn(['ORDER_PAYMENT', 'DEPOSIT', 'ADVANCE', 'CREDIT_APPLIED', 'REFUND'])
  type?: string;
  @IsOptional() @IsString() orderId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() paymentMethodId?: string;
  @IsOptional() @Type(() => String) @IsDateString() from?: string;
  @IsOptional() @Type(() => String) @IsDateString() to?: string;
}

export class ReceivablesQuery {
  @IsOptional() @IsString() customerId?: string;
  /** Leave out customers who owe nothing (the default). */
  @IsOptional()
  @Transform(({ value }) => value !== 'false' && value !== false)
  includeSettled?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}
