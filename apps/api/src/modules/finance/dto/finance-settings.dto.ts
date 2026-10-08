import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export const ACCOUNT_TYPES = ['CASH', 'BANK', 'MOBILE_WALLET', 'CARD_TERMINAL'] as const;
export const METHOD_TYPES = ['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_MONEY', 'OTHER'] as const;

const text = (max: number) => MaxLength(max);

export class CreateAccountDto {
  @IsIn(ACCOUNT_TYPES) type!: (typeof ACCOUNT_TYPES)[number];
  @IsString() @IsNotEmpty() @text(120) name!: string;
  @IsOptional() @IsString() @text(120) bankName?: string | null;
  @IsOptional() @IsString() @text(120) accountTitle?: string | null;
  @IsOptional() @IsString() @text(60) accountNumber?: string | null;
  @IsOptional() @IsString() @text(120) branch?: string | null;
  /** Only customer-facing accounts appear on documents and in bank-details messages (Requirement 40.2). */
  @IsOptional() @IsBoolean() showToCustomers?: boolean;
}

export class UpdateAccountDto {
  @IsOptional() @IsString() @IsNotEmpty() @text(120) name?: string;
  @IsOptional() @IsString() @text(120) bankName?: string | null;
  @IsOptional() @IsString() @text(120) accountTitle?: string | null;
  @IsOptional() @IsString() @text(60) accountNumber?: string | null;
  @IsOptional() @IsString() @text(120) branch?: string | null;
  @IsOptional() @IsBoolean() showToCustomers?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateMethodDto {
  @IsString() @IsNotEmpty() @text(80) name!: string;
  @IsIn(METHOD_TYPES) type!: (typeof METHOD_TYPES)[number];
  @IsString() @IsNotEmpty() accountId!: string;
  @IsOptional() @IsBoolean() requiresReference?: boolean;
}

export class UpdateMethodDto {
  @IsOptional() @IsString() @IsNotEmpty() @text(80) name?: string;
  @IsOptional() @IsIn(METHOD_TYPES) type?: (typeof METHOD_TYPES)[number];
  @IsOptional() @IsString() @IsNotEmpty() accountId?: string;
  @IsOptional() @IsBoolean() requiresReference?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ListFinanceQuery {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
