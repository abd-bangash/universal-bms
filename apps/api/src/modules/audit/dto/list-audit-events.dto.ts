import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/pagination';

export class ListAuditEventsQuery extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(100) entityType?: string;
  @IsOptional() @IsString() @MaxLength(100) entityId?: string;
  @IsOptional() @IsString() @MaxLength(100) actorUserId?: string;
  @IsOptional() @IsString() @MaxLength(100) action?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}
