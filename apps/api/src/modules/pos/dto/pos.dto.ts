import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsDecimalString } from '../../../common/money';
import { PageQueryDto } from '../../../common/pagination/pagination';
import { DiscountDto, LineInputDto } from '../../pricing/pricing.dto';

export class SalePaymentDto {
  @IsString() @IsNotEmpty() paymentMethodId!: string;
  /** Cash only: what the customer handed over. Defaults to the total. */
  @IsOptional() @IsDecimalString() tendered?: string;
  @IsOptional() @IsString() @MaxLength(120) referenceNumber?: string;
}

export class CheckoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LineInputDto)
  lines!: LineInputDto[];
  @IsOptional() @ValidateNested() @Type(() => DiscountDto) orderDiscount?: DiscountDto | null;
  /** The walk-in customer when left out. */
  @IsOptional() @IsString() customerId?: string;
  /** Credited with the sale; the cashier when left out (Requirement 12.13). */
  @IsOptional() @IsString() salespersonId?: string;
  @ValidateNested() @Type(() => SalePaymentDto) payment!: SalePaymentDto;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ListReceiptsQuery extends PageQueryDto {
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
