import {
  IsBoolean,
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

export const COMMISSION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'PAID', 'REVERSED'] as const;
export const CALC_TYPES = ['PERCENTAGE', 'FIXED_PER_ORDER', 'FIXED_PER_UNIT'] as const;
export const BASE_TYPES = ['NET_SALES', 'GROSS_SALES', 'GROSS_PROFIT'] as const;
export const SCOPES = ['ALL', 'CATEGORY', 'PRODUCT', 'ORDER_TYPE'] as const;

export class ListCommissionsQuery extends PageQueryDto {
  @IsOptional() @IsString() salespersonId?: string;
  @IsOptional() @IsIn(COMMISSION_STATUSES) status?: (typeof COMMISSION_STATUSES)[number];
  @IsOptional() @IsString() orderId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class RejectCommissionDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class PayCommissionDto {
  @IsString() @IsNotEmpty() @MaxLength(100) method!: string;
  /** When it was paid; now when left out. */
  @IsOptional() @IsDateString() paidAt?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

class RuleFields {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(CALC_TYPES) calcType?: (typeof CALC_TYPES)[number];
  @IsOptional() @IsDecimalString() rate?: string;
  @IsOptional() @IsIn(BASE_TYPES) baseType?: (typeof BASE_TYPES)[number];
  @IsOptional() @IsIn(SCOPES) scope?: (typeof SCOPES)[number];
  @IsOptional() @IsString() scopeId?: string | null;
  @IsOptional() @IsString() salespersonId?: string | null;
  @IsOptional() @IsInt() @Min(-1000) @Max(1000) priority?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateRuleDto extends RuleFields {
  @IsString() @IsNotEmpty() @MaxLength(120) declare name: string;
  @IsIn(CALC_TYPES) declare calcType: (typeof CALC_TYPES)[number];
  @IsDecimalString() declare rate: string;
}

export class UpdateRuleDto extends RuleFields {}

export class SetStaffCommissionDto {
  /** The percentage of net sales this person earns (0 to 100). 0 switches it off. */
  @IsDecimalString() percent!: string;
}

export class PerformanceQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
