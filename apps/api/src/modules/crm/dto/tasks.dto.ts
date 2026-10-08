import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/pagination';
import { LINKABLE_ENTITY_TYPES } from '../entity-link.registry';

export const TASK_TYPES = ['CALL', 'FOLLOW_UP', 'MEETING', 'REMINDER', 'TODO'] as const;

export class CreateTaskDto {
  @IsIn(TASK_TYPES) type!: (typeof TASK_TYPES)[number];
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsDateString() dueAt?: string | null;
  /** Defaults to the person creating the task. */
  @IsOptional() @IsString() assignedToId?: string | null;
  @IsOptional() @IsIn(LINKABLE_ENTITY_TYPES as unknown as string[]) entityType?: string;
  @IsOptional() @IsString() entityId?: string;
}

export class UpdateTaskDto {
  @IsOptional() @IsIn(TASK_TYPES) type?: (typeof TASK_TYPES)[number];
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsDateString() dueAt?: string | null;
  @IsOptional() @IsString() assignedToId?: string | null;
  /** Reopen or cancel; completing goes through `POST /tasks/:id/complete`. */
  @IsOptional() @IsIn(['OPEN', 'CANCELLED']) status?: 'OPEN' | 'CANCELLED';
}

export class ListTasksQuery extends PageQueryDto {
  /** Only tasks assigned to me. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  mine?: boolean;
  @IsOptional() @IsString() assignedToId?: string;
  @IsOptional() @IsIn(['OPEN', 'DONE', 'CANCELLED']) status?: 'OPEN' | 'DONE' | 'CANCELLED';
  @IsOptional() @IsIn(TASK_TYPES) type?: string;
  @IsOptional() @IsIn(LINKABLE_ENTITY_TYPES as unknown as string[]) entityType?: string;
  @IsOptional() @IsString() entityId?: string;
  /** Open tasks only: overdue (before now), today (rest of the day), upcoming (later), none (no due date). */
  @IsOptional() @IsIn(['overdue', 'today', 'upcoming', 'none']) due?:
    'overdue' | 'today' | 'upcoming' | 'none';
}

export const NOTE_KINDS = ['NOTE', 'CALL'] as const;

export class CreateNoteDto {
  @IsIn(LINKABLE_ENTITY_TYPES as unknown as string[]) entityType!: string;
  @IsString() @IsNotEmpty() entityId!: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) body!: string;
  @IsOptional() @IsIn(NOTE_KINDS) kind?: (typeof NOTE_KINDS)[number];
  /** Call logs only. */
  @IsOptional() @IsIn(['INBOUND', 'OUTBOUND']) callDirection?: 'INBOUND' | 'OUTBOUND';
  @IsOptional()
  @IsIn(['ANSWERED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'WRONG_NUMBER'])
  callOutcome?: string;
}

export class ListNotesQuery {
  @IsIn(LINKABLE_ENTITY_TYPES as unknown as string[]) entityType!: string;
  @IsString() @IsNotEmpty() entityId!: string;
}
