import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { LoginResult, TokenPair } from '@bms/types';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthThrottle } from '../../common/throttle/throttle';
import { AuthService } from './auth.service';
import { AcceptInvitationDto } from '../users/dto/users.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  ResetPasswordDto,
  SelectWorkspaceDto,
  SwitchWorkspaceDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Public()
  @AuthThrottle()
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('select-workspace')
  @Public()
  @AuthThrottle()
  @HttpCode(200)
  selectWorkspace(@Body() dto: SelectWorkspaceDto): Promise<TokenPair> {
    return this.auth.selectWorkspace(dto.loginTicket, dto.workspaceId);
  }

  @Post('refresh')
  @Public()
  @AuthThrottle()
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<TokenPair> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('password/forgot')
  @Public()
  @AuthThrottle()
  @HttpCode(202)
  async forgot(@Body() dto: ForgotPasswordDto): Promise<{ accepted: true }> {
    await this.auth.forgotPassword(dto.email);
    return { accepted: true };
  }

  @Post('password/reset')
  @Public()
  @AuthThrottle()
  @HttpCode(204)
  async reset(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.newPassword);
  }

  @Post('invite/accept')
  @Public()
  @AuthThrottle()
  @HttpCode(200)
  acceptInvite(@Body() dto: AcceptInvitationDto): Promise<{ workspaceId: string }> {
    return this.auth.acceptInvitation(dto);
  }

  @Post('switch-workspace')
  @Authenticated()
  @ApiBearerAuth()
  @HttpCode(200)
  switchWorkspace(
    @CurrentUser() user: AuthUser,
    @Body() dto: SwitchWorkspaceDto,
  ): Promise<TokenPair> {
    return this.auth.switchWorkspace(user, dto.workspaceId);
  }

  @Post('logout')
  @Authenticated()
  @ApiBearerAuth()
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.logout(user);
  }

  @Post('password/change')
  @Authenticated()
  @ApiBearerAuth()
  @HttpCode(204)
  async change(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto): Promise<void> {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword);
  }

  @Get('me')
  @Authenticated()
  @ApiBearerAuth()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @Get('sessions')
  @Authenticated()
  @ApiBearerAuth()
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user);
  }

  @Delete('sessions/:id')
  @Authenticated()
  @ApiBearerAuth()
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.auth.revokeSession(user, id);
  }
}
