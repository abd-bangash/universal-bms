import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/pagination';

export const CONVERSATION_STATUSES = ['OPEN', 'PENDING', 'CLOSED'] as const;
export const TEMPLATE_KINDS = [
  'QUICK_REPLY',
  'MESSAGE',
  'PROVIDER',
  'NOTIFICATION',
  'BANK_DETAILS',
] as const;
export const PROVIDER_STATUSES = ['APPROVED', 'PENDING', 'REJECTED'] as const;
export const ATTACHMENT_TYPES = ['FILE', 'QUOTATION', 'INVOICE', 'RECEIPT'] as const;

const bool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class ListConversationsQuery extends PageQueryDto {
  @IsOptional() @IsIn(CONVERSATION_STATUSES) status?: (typeof CONVERSATION_STATUSES)[number];
  /** A user id, `me`, or `none` for conversations nobody has taken yet. */
  @IsOptional() @IsString() @MaxLength(60) assigned?: string;
  @IsOptional() @Transform(bool) @IsBoolean() unread?: boolean;
  @IsOptional() @Transform(bool) @IsBoolean() needsHuman?: boolean;
  @IsOptional() @IsString() @MaxLength(60) customerId?: string;
  @IsOptional() @IsString() @MaxLength(60) leadId?: string;
}

export class UpdateConversationDto {
  @IsOptional() @IsString() @MaxLength(60) assignedToId?: string | null;
  @IsOptional() @IsIn(CONVERSATION_STATUSES) status?: (typeof CONVERSATION_STATUSES)[number];
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) customerId?: string;
  @IsOptional() @IsBoolean() automationActive?: boolean;
  @IsOptional() @IsBoolean() aiEnabled?: boolean;
}

export class AttachmentRefDto {
  @IsIn(ATTACHMENT_TYPES) type!: (typeof ATTACHMENT_TYPES)[number];
  @IsString() @IsNotEmpty() @MaxLength(60) id!: string;
}

export class SendMessageDto {
  @IsOptional() @IsString() @MaxLength(4096) body?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) templateId?: string;
  /** Values for a provider template's numbered placeholders, in order. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  parameters?: string[];
  /** The order the template's {{order_number}}, {{order_total}} and {{balance_due}} are about. */
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) orderId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => AttachmentRefDto)
  attachments?: AttachmentRefDto[];
}

export class ListMessagesQuery extends PageQueryDto {}

export class ListTemplatesQuery {
  @IsOptional() @IsIn(TEMPLATE_KINDS) kind?: (typeof TEMPLATE_KINDS)[number];
  @IsOptional() @Transform(bool) @IsBoolean() active?: boolean;
}

class TemplateFields {
  @IsOptional() @IsString() @MaxLength(40) channel?: string | null;
  @IsOptional() @IsString() @MaxLength(120) providerName?: string | null;
  @IsOptional() @IsString() @MaxLength(20) language?: string | null;
  @IsOptional() @IsIn(PROVIDER_STATUSES) providerStatus?: (typeof PROVIDER_STATUSES)[number] | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateTemplateDto extends TemplateFields {
  @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @IsIn(TEMPLATE_KINDS) kind!: (typeof TEMPLATE_KINDS)[number];
  @IsString() @IsNotEmpty() @MaxLength(4096) body!: string;
}

export class UpdateTemplateDto extends TemplateFields {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(4096) body?: string;
}
