import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  CreateNoteDto,
  CreateTaskDto,
  ListNotesQuery,
  ListTasksQuery,
  UpdateTaskDto,
} from './dto/tasks.dto';
import { NotesService } from './notes.service';
import { TasksService } from './tasks.service';

class IdParam {
  @IsString() id!: string;
}

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermission('task:view')
  list(@CurrentUser() user: AuthUser, @Query() query: ListTasksQuery) {
    return this.tasks.list(user, query);
  }

  @Post()
  @RequirePermission('task:create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskDto) {
    return this.tasks.create(user, dto);
  }

  @Get(':id')
  @RequirePermission('task:view')
  get(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.tasks.get(user, p.id);
  }

  @Patch(':id')
  @RequirePermission('task:edit')
  update(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(user, p.id, dto);
  }

  @Post(':id/complete')
  @RequirePermission('task:edit')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.tasks.complete(user, p.id);
  }
}

/** Notes take the permission of the record they sit on, so the check is made by the service. */
@ApiTags('notes')
@ApiBearerAuth()
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  @Authenticated()
  list(@CurrentUser() user: AuthUser, @Query() query: ListNotesQuery) {
    return this.notes.list(user, query.entityType, query.entityId);
  }

  @Post()
  @Authenticated()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateNoteDto) {
    return this.notes.create(user, dto);
  }
}
