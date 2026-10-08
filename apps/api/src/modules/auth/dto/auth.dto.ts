import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) password!: string;
}

export class SelectWorkspaceDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) loginTicket!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) workspaceId!: string;
}

export class SwitchWorkspaceDto {
  @IsString() @IsNotEmpty() @MaxLength(100) workspaceId!: string;
}

export class RefreshDto {
  @IsString() @IsNotEmpty() @MaxLength(200) refreshToken!: string;
}

export class ForgotPasswordDto {
  @IsEmail() @MaxLength(254) email!: string;
}

export class ResetPasswordDto {
  @IsString() @IsNotEmpty() @MaxLength(200) token!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) newPassword!: string;
}

export class ChangePasswordDto {
  @IsString() @IsNotEmpty() @MaxLength(200) currentPassword!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) newPassword!: string;
}
