import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class ConnectIntegrationDto {
  @IsString() @IsNotEmpty() @MaxLength(60) provider!: string;
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
  /** Credentials and settings by field key, as the provider's definition lists them. */
  @IsObject() values!: Record<string, string>;
}
