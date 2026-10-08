import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  FILE_ENTITY_TYPES,
  FILE_PURPOSES,
  type FileEntityType,
  type FilePurpose,
} from '../entity-access';

/** The text fields sent alongside the file in the multipart body. */
export class UploadFileDto {
  @IsOptional() @IsEnum(FILE_ENTITY_TYPES) entityType?: FileEntityType;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) entityId?: string;
  @IsOptional() @IsEnum(FILE_PURPOSES) purpose?: FilePurpose;
}

export interface FileDto {
  id: string;
  name: string;
  mime: string;
  size: number;
  entityType: string | null;
  entityId: string | null;
  purpose: string | null;
  hasThumbnail: boolean;
  createdAt: string;
}

export interface FileUrlDto {
  url: string;
  thumbnailUrl: string | null;
  expiresAt: string;
}
