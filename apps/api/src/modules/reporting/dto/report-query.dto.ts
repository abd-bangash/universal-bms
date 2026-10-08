import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ReportQueryDto {
  /** A local calendar day, `YYYY-MM-DD`, in the workspace's timezone. */
  @IsOptional() @Matches(DAY, { message: 'must be a date such as 2026-03-31' }) from?: string;
  @IsOptional() @Matches(DAY, { message: 'must be a date such as 2026-03-31' }) to?: string;
  @IsOptional() @IsIn(['today', 'week', 'month']) range?: 'today' | 'week' | 'month';
  @IsOptional() @IsString() @MaxLength(100) salespersonId?: string;
  @IsOptional() @IsString() @MaxLength(100) categoryId?: string;
  @IsOptional() @IsString() @MaxLength(100) locationId?: string;
  @IsOptional() @IsString() @MaxLength(100) status?: string;
  @IsOptional() @IsString() @MaxLength(100) stage?: string;
  @IsOptional() @IsString() @MaxLength(100) source?: string;
  /** The row to drill into (drill-down only). */
  @IsOptional() @IsString() @MaxLength(300) row?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number;
}
