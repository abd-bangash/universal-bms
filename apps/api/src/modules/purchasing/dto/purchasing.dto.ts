import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
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
import { IsDecimalString } from '../../../common/money';
import { PageQueryDto } from '../../../common/pagination/pagination';

class SupplierFields {
  @IsOptional() @IsString() @MaxLength(200) contactName?: string | null;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string | null;
  @IsOptional() @IsString() @MaxLength(500) address?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
  @IsOptional() customFields?: Record<string, unknown>;
}

export class CreateSupplierDto extends SupplierFields {
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
}

export class UpdateSupplierDto extends SupplierFields {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
}

export class ListSuppliersQuery extends PageQueryDto {
  @IsOptional() @IsIn(['ACTIVE', 'ARCHIVED']) status?: 'ACTIVE' | 'ARCHIVED';
}

export class PurchaseLineDto {
  @IsString() @IsNotEmpty() variantId!: string;
  /** In the purchase unit. */
  @IsDecimalString() quantity!: string;
  /** Per purchase unit; the product's cost price when left out. */
  @IsOptional() @IsDecimalString() unitCost?: string;
}

class PurchaseFields {
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsDateString() expectedDate?: string | null;
  @IsOptional() @IsDecimalString() taxAmount?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
  @IsOptional() customFields?: Record<string, unknown>;
}

export class CreatePurchaseDto extends PurchaseFields {
  @IsString() @IsNotEmpty() supplierId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines!: PurchaseLineDto[];
}

export class UpdatePurchaseDto extends PurchaseFields {
  /** The version the client last read; a stale one is rejected with 409. */
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() supplierId?: string;
  /** Replaces all lines; only while the order is a draft. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines?: PurchaseLineDto[];
}

export class ListPurchasesQuery extends PageQueryDto {
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class ChangePurchaseStatusDto {
  @IsString() @IsNotEmpty() status!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ReceiveLineDto {
  @IsString() @IsNotEmpty() itemId!: string;
  @IsDecimalString() quantity!: string;
  /** What was actually paid per purchase unit; the order's cost when left out. */
  @IsOptional() @IsDecimalString() unitCost?: string;
}

export class ReceivePurchaseDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines!: ReceiveLineDto[];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class QuickPurchaseDto extends CreatePurchaseDto {
  @IsOptional() @IsString() @MaxLength(1000) receiptNote?: string;
}
