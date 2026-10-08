import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsDecimalString } from '../../../common/money';
import { PageQueryDto } from '../../../common/pagination/pagination';

export class CreateExpenseCategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
}

export class UpdateExpenseCategoryDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ListExpenseCategoriesQuery {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreateExpenseDto {
  @IsString() @IsNotEmpty() categoryId!: string;
  @IsDecimalString() amount!: string;
  @IsDateString() expenseDate!: string;
  /** The account the money left is the method's account. */
  @IsString() @IsNotEmpty() paymentMethodId!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsString() attachmentFileId?: string;
  @IsOptional() customFields?: Record<string, unknown>;
}

export class VoidExpenseDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string;
}

export class ListExpensesQuery extends PageQueryDto {
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsIn(['POSTED', 'VOIDED']) status?: string;
  @IsOptional() @Type(() => String) @IsDateString() from?: string;
  @IsOptional() @Type(() => String) @IsDateString() to?: string;
}
