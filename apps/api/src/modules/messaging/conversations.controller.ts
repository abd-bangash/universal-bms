import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ConversationsService } from './conversations.service';
import {
  ListConversationsQuery,
  ListMessagesQuery,
  SendMessageDto,
  UpdateConversationDto,
} from './dto/messaging.dto';

class IdParam {
  @IsString() id!: string;
}

@ApiTags('conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @RequirePermission('conversation:view')
  list(@CurrentUser() user: AuthUser, @Query() query: ListConversationsQuery) {
    return this.conversations.list(user, query);
  }

  // Declared before ':id' so the fixed path is not read as an id.
  @Get('unread-count')
  @RequirePermission('conversation:view')
  unread(@CurrentUser() user: AuthUser) {
    return this.conversations.unreadCount(user);
  }

  @Get(':id')
  @RequirePermission('conversation:view')
  get(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.conversations.get(user, p.id);
  }

  @Get(':id/messages')
  @RequirePermission('conversation:view')
  messages(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Query() query: ListMessagesQuery) {
    return this.conversations.messages(user, p.id, query);
  }

  @Post(':id/messages')
  @Idempotent()
  @RequirePermission('conversation:reply')
  send(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: SendMessageDto) {
    return this.conversations.send(user, p.id, dto);
  }

  /** Each change is checked against its own permission in the service (assign, reply, automation, AI). */
  @Patch(':id')
  @RequirePermission('conversation:view')
  update(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: UpdateConversationDto) {
    return this.conversations.update(user, p.id, dto);
  }

  @Post(':id/read')
  @HttpCode(200)
  @RequirePermission('conversation:view')
  read(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.conversations.markRead(user, p.id);
  }
}
