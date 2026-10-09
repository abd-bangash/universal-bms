import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
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
