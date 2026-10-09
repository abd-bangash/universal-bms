import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/pagination';

export class ApplySuggestionDto {
  /** The suggestion as the person edited it; leave out to approve it as it is. */
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
}

export class CreateKnowledgeDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) body!: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateKnowledgeDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(4000) body?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ListLogsQuery extends PageQueryDto {}

/** What `ai:control` may change about the assistant. Release 1 offers OFF and ASSIST; AUTO_REPLY comes later. */
export class UpdateAiSettingsDto {
  @IsOptional() @IsIn(['OFF', 'ASSIST']) mode?: 'OFF' | 'ASSIST';
  @IsOptional() @IsString() @MaxLength(60) provider?: string;
  @IsOptional() @IsString() @MaxLength(100) model?: string;
  @IsOptional() @IsIn(['FORMAL', 'FRIENDLY']) tone?: 'FORMAL' | 'FRIENDLY';
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(20) replyLanguage?: string;
  @IsOptional() @IsInt() @Min(50) @Max(4000) maxReplyChars?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) confidenceThreshold?: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  escalationKeywords?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(50) contextMessageCount?: number;
  @IsOptional() @IsInt() @Min(0) dailyRequestLimit?: number;
  @IsOptional() @IsInt() @Min(0) monthlyTokenBudget?: number;
}
