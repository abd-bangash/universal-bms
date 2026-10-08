import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
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

export const LEAD_SOURCES = [
  'MESSAGING',
  'SOCIAL',
  'STORE',
  'WEBSITE',
  'MANUAL',
  'IMPORT',
] as const;
export const LEAD_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;

class LeadFields {
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string | null;
  @IsOptional() @IsIn(LEAD_SOURCES) source?: (typeof LEAD_SOURCES)[number] | null;
  @IsOptional() @IsString() @MaxLength(60) channel?: string | null;
  @IsOptional() @IsString() @MaxLength(120) campaign?: string | null;
  @IsOptional() @IsString() @MaxLength(120) adId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) formId?: string | null;
  @IsOptional() @IsString() @MaxLength(500) interest?: string | null;
  @IsOptional() @IsString() productId?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) requirements?: string | null;
  @IsOptional() @IsDecimalString() quantity?: string | null;
  @IsOptional() @IsDecimalString() estimatedValue?: string | null;
  @IsOptional() @IsDecimalString() quotedAmount?: string | null;
  @IsOptional() @IsIn(LEAD_PRIORITIES) priority?: (typeof LEAD_PRIORITIES)[number];
  @IsOptional() @IsString() @MaxLength(300) nextAction?: string | null;
  @IsOptional() @IsDateString() nextActionDate?: string | null;
  @IsOptional() customFields?: Record<string, unknown>;
}

export class CreateLeadDto extends LeadFields {
  @IsString() @IsNotEmpty() @MaxLength(200) fullName!: string;
  /** Only honoured for users who may assign leads (`lead:assign`). */
  @IsOptional() @IsString() assignedToId?: string | null;
  /** Create anyway, even if an open lead for this contact exists inside the dedup window. */
  @IsOptional() @IsBoolean() allowDuplicate?: boolean;
}

export class UpdateLeadDto extends LeadFields {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) fullName?: string;
}

export class ChangeStageDto {
  @IsString() @IsNotEmpty() stage!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  /** Required when moving to the Lost stage (Requirement 9.5). */
  @IsOptional() @IsString() lostReasonId?: string;
}

export class AssignLeadDto {
  @IsOptional() @IsString() assignedToId?: string | null;
}

// The Order target is wired in task 35.
export const CONVERT_TARGETS = ['CUSTOMER', 'QUOTATION'] as const;

export class ConvertLeadDto {
  @IsIn(CONVERT_TARGETS) target!: (typeof CONVERT_TARGETS)[number];
  /** Link to this existing customer instead of looking for a match. */
  @IsOptional() @IsString() customerId?: string;
  /** Skip matching and always create a new customer. */
  @IsOptional() @IsBoolean() createNew?: boolean;
}

export class ListLeadsQuery extends PageQueryDto {
  @IsOptional() @IsString() stage?: string;
  @IsOptional() @IsString() assignedToId?: string;
  @IsOptional() @IsIn(LEAD_PRIORITIES) priority?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() customerId?: string;
  /** `open` hides leads in a Won or Lost state. */
  @IsOptional() @IsIn(['open', 'closed']) state?: 'open' | 'closed';
}

export class AnalyticsQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class PipelineQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) cardsPerColumn?: number;
}
