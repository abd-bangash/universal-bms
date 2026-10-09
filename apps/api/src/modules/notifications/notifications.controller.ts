import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { PageQueryDto } from '../../common/pagination/pagination';
import { NotificationsService } from './notifications.service';

class IdParam {
  @IsString() id!: string;
}

class ListNotificationsQuery extends PageQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  unread?: boolean;
}

/** Everyone's own notifications: a signed-in person needs no permission to read what was sent to them. */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Authenticated()
  list(@CurrentUser() user: AuthUser, @Query() query: ListNotificationsQuery) {
    return this.notifications.list(user, query);
  }

  // Declared before ':id' so the fixed paths are not read as ids.
  @Get('unread-count')
  @Authenticated()
  unread(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user);
  }

  @Post('read-all')
  @HttpCode(200)
  @Authenticated()
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.readAll(user);
  }

  @Post(':id/read')
  @HttpCode(200)
  @Authenticated()
  read(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.notifications.markRead(user, p.id);
  }
}
