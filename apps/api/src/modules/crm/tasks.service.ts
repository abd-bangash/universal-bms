import { Injectable } from '@nestjs/common';
import { Prisma, type Task } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { DomainEventBus } from '../../common/events/domain-event-bus';
import {
  decodeCursor,
  parseSort,
  toPage,
  type Page,
  type SortSpec,
} from '../../common/pagination/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { dayBounds } from './day-bounds';
import type { CreateTaskDto, ListTasksQuery, UpdateTaskDto } from './dto/tasks.dto';
import { EntityLinkRegistry, type TimelineTarget } from './entity-link.registry';
import { TimelineService } from './timeline.service';

const SORTS = ['dueAt', 'createdAt'] as const;

export interface TaskDto {
  id: string;
  type: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  status: string;
  assignedToId: string | null;
  entityType: string | null;
  entityId: string | null;
  createdById: string | null;
  completedById: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const toDto = (t: Task): TaskDto => ({
  id: t.id,
  type: t.type,
  title: t.title,
  description: t.description,
  dueAt: t.dueAt ? t.dueAt.toISOString() : null,
  status: t.status,
  assignedToId: t.assignedToId,
  entityType: t.entityType,
  entityId: t.entityId,
  createdById: t.createdById,
  completedById: t.completedById,
  completedAt: t.completedAt ? t.completedAt.toISOString() : null,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});

const audited = (t: TaskDto): Record<string, unknown> => t as unknown as Record<string, unknown>;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly links: EntityLinkRegistry,
    private readonly timeline: TimelineService,
    private readonly settings: SettingsService,
    private readonly events: DomainEventBus,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────────────────────────

  /** Without `task:view_all` a person sees the tasks assigned to or created by them. */
  private scope(user: AuthUser): Prisma.TaskWhereInput {
    return user.permissions.includes('task:view_all')
      ? {}
      : { OR: [{ assignedToId: user.userId }, { createdById: user.userId }] };
  }

  async list(user: AuthUser, query: ListTasksQuery): Promise<Page<TaskDto>> {
    const sort = parseSort(query.sort, SORTS, { field: 'dueAt', direction: 'asc' });
    const filters: Prisma.TaskWhereInput[] = [this.scope(user)];
    if (query.mine) filters.push({ assignedToId: user.userId });
    if (query.assignedToId) filters.push({ assignedToId: query.assignedToId });
    filters.push({ status: query.status ?? 'OPEN' });
    if (query.type) filters.push({ type: query.type as Task['type'] });
    if (query.entityType) filters.push({ entityType: query.entityType });
    if (query.entityId) filters.push({ entityId: query.entityId });
    if (query.q?.trim()) filters.push({ title: { contains: query.q.trim(), mode: 'insensitive' } });
    if (query.due) {
      const now = new Date();
      const timeZone = await this.settings.get<string>('locale.timezone');
      const { end } = dayBounds(now, timeZone);
      filters.push(
        query.due === 'overdue'
          ? { dueAt: { lt: now } }
          : query.due === 'today'
            ? { dueAt: { gte: now, lt: end } }
            : query.due === 'upcoming'
              ? { dueAt: { gte: end } }
              : { dueAt: null },
      );
    }
    // Tasks with no due date sort last whichever way the list runs, so the keyset has a NULL branch.
    const after = this.after(sort, query.cursor);
    if (after) filters.push(after);
    const rows = await this.prisma.scoped.task.findMany({
      where: { AND: filters },
      orderBy: [{ [sort.field]: { sort: sort.direction, nulls: 'last' } }, { id: sort.direction }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) => {
      const value = last[sort.field as 'dueAt' | 'createdAt'];
      return { v: value ? value.toISOString() : null, id: last.id };
    }).map(toDto);
  }

  private after(sort: SortSpec, cursor: string | undefined): Prisma.TaskWhereInput | undefined {
    if (!cursor) return undefined;
    const { v, id } = decodeCursor(cursor);
    if (
      typeof id !== 'string' ||
      (v !== null && (typeof v !== 'string' || Number.isNaN(Date.parse(v))))
    ) {
      throw new ValidationFailedException({ cursor: ['is not a valid cursor'] });
    }
    const field = sort.field as 'dueAt' | 'createdAt';
    const op = sort.direction === 'asc' ? 'gt' : 'lt';
    if (v === null) return { AND: [{ [field]: null }, { id: { [op]: id } }] };
    const at = new Date(v as string);
    return {
      OR: [
        { [field]: { [op]: at } },
        ...(field === 'dueAt' ? [{ dueAt: null }] : []), // undated tasks come after every dated one
        { AND: [{ [field]: at }, { id: { [op]: id } }] },
      ],
    };
  }

  async get(user: AuthUser, id: string): Promise<TaskDto> {
    return toDto(await this.row(user, id));
  }

  // ── writes ──────────────────────────────────────────────────────────────────────────────

  async create(user: AuthUser, dto: CreateTaskDto): Promise<TaskDto> {
    if (Boolean(dto.entityType) !== Boolean(dto.entityId)) {
      throw new ValidationFailedException({
        entityId: ['entityType and entityId must be given together'],
      });
    }
    const target =
      dto.entityType && dto.entityId
        ? await this.links.resolve(user, dto.entityType, dto.entityId, 'edit')
        : null;
    const assignedToId = dto.assignedToId === undefined ? user.userId : dto.assignedToId;
    await this.assertAssignee(assignedToId);

    const task = await this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.task.create({
        data: {
          workspaceId: user.workspaceId,
          type: dto.type,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          assignedToId,
          entityType: dto.entityType ?? null,
          entityId: dto.entityId ?? null,
          createdById: user.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'task.create',
        entityType: 'Task',
        entityId: row.id,
        after: audited(toDto(row)),
      });
      return row;
    });
    if (target) await this.note(target, task, `Task added: ${task.title}`, user.userId);
    return toDto(task);
  }

  async update(user: AuthUser, id: string, dto: UpdateTaskDto): Promise<TaskDto> {
    const existing = await this.row(user, id);
    if (existing.status === 'DONE') {
      throw new AppException('VALIDATION_FAILED', 422, 'A completed task cannot be changed');
    }
    if (dto.assignedToId !== undefined) await this.assertAssignee(dto.assignedToId);
    const dueChanged =
      dto.dueAt !== undefined &&
      (dto.dueAt ? new Date(dto.dueAt).getTime() : null) !== (existing.dueAt?.getTime() ?? null);

    const row = await this.prisma.scoped.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id },
        data: {
          type: dto.type,
          title: dto.title?.trim(),
          description: dto.description === undefined ? undefined : dto.description?.trim() || null,
          dueAt: dto.dueAt === undefined ? undefined : dto.dueAt ? new Date(dto.dueAt) : null,
          assignedToId: dto.assignedToId,
          status: dto.status,
          // a new due date is a new chance to be reminded
          ...(dueChanged || dto.status === 'OPEN' ? { dueNotifiedAt: null } : {}),
        },
      });
      await this.audit.record(tx, {
        action: 'task.update',
        entityType: 'Task',
        entityId: id,
        before: audited(toDto(existing)),
        after: audited(toDto(updated)),
      });
      return updated;
    });
    return toDto(row);
  }

  /** Records who finished the task and when, and adds a line to the linked record's timeline (Requirement 30.6). */
  async complete(user: AuthUser, id: string): Promise<TaskDto> {
    const existing = await this.row(user, id);
    if (existing.status === 'DONE') return toDto(existing);
    if (existing.status === 'CANCELLED') {
      throw new AppException(
        'VALIDATION_FAILED',
        422,
        'A cancelled task cannot be completed; reopen it first',
      );
    }
    const row = await this.prisma.scoped.$transaction(async (tx) => {
      const done = await tx.task.update({
        where: { id },
        data: { status: 'DONE', completedById: user.userId, completedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'task.complete',
        entityType: 'Task',
        entityId: id,
        before: { status: existing.status },
        after: { status: 'DONE', completedById: user.userId },
      });
      return done;
    });
    const target = await this.targetOf(row);
    if (target) await this.note(target, row, `Task completed: ${row.title}`, user.userId);
    return toDto(row);
  }

  // ── lead follow-ups (Requirement 30.5) ──────────────────────────────────────────────────────

  /**
   * Keeps the lead's single open FOLLOW_UP task in step with its next action and date: created or
   * updated when both are set, cancelled when they are cleared.
   */
  async syncLeadFollowUp(
    lead: {
      id: string;
      workspaceId: string;
      nextAction: string | null;
      nextActionDate: Date | null;
      assignedToId: string | null;
      createdById: string | null;
    },
    actorUserId: string | null,
  ): Promise<void> {
    const open = await this.prisma.scoped.task.findFirst({
      where: { entityType: 'LEAD', entityId: lead.id, type: 'FOLLOW_UP', status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
    });
    const wanted = lead.nextAction && lead.nextActionDate;
    if (!wanted) {
      if (open)
        await this.prisma.scoped.task.update({
          where: { id: open.id },
          data: { status: 'CANCELLED' },
        });
      return;
    }
    const assignee = lead.assignedToId ?? lead.createdById;
    if (open) {
      const dueChanged = open.dueAt?.getTime() !== lead.nextActionDate?.getTime();
      await this.prisma.scoped.task.update({
        where: { id: open.id },
        data: {
          title: lead.nextAction as string,
          dueAt: lead.nextActionDate,
          assignedToId: assignee,
          ...(dueChanged ? { dueNotifiedAt: null } : {}),
        },
      });
    } else {
      await this.prisma.scoped.task.create({
        data: {
          workspaceId: lead.workspaceId,
          type: 'FOLLOW_UP',
          title: lead.nextAction as string,
          dueAt: lead.nextActionDate,
          assignedToId: assignee,
          entityType: 'LEAD',
          entityId: lead.id,
          createdById: actorUserId,
        },
      });
    }
  }

  /** Cancels the open follow-up of a lead that has been closed. */
  async cancelLeadFollowUp(leadId: string): Promise<void> {
    await this.prisma.scoped.task.updateMany({
      where: { entityType: 'LEAD', entityId: leadId, type: 'FOLLOW_UP', status: 'OPEN' },
      data: { status: 'CANCELLED' },
    });
  }

  // ── the due scan (Requirement 30.4) ─────────────────────────────────────────────────────────

  /**
   * Publishes `task.due` once for every open task whose time has come, in the workspace in
   * context. Each task is claimed with a conditional update, so two instances never both notify.
   */
  async publishDue(workspaceId: string, now = new Date()): Promise<number> {
    const due = await this.prisma.scoped.task.findMany({
      where: { status: 'OPEN', dueAt: { lte: now }, dueNotifiedAt: null },
      orderBy: { dueAt: 'asc' },
      take: 500,
    });
    let published = 0;
    for (const task of due) {
      const claimed = await this.prisma.scoped.task.updateMany({
        where: { id: task.id, dueNotifiedAt: null, status: 'OPEN' },
        data: { dueNotifiedAt: now },
      });
      if (claimed.count === 0) continue;
      await this.events.publish('task.due', { workspaceId, taskId: task.id, actorUserId: null });
      published += 1;
    }
    return published;
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────

  private async row(user: AuthUser, id: string): Promise<Task> {
    const task = await this.prisma.scoped.task.findFirst({
      where: { AND: [{ id }, this.scope(user)] },
    });
    if (!task) throw new NotFoundAppException();
    return task;
  }

  private async assertAssignee(userId: string | null | undefined): Promise<void> {
    if (!userId) return;
    const member = await this.prisma.scoped.userWorkspace.findFirst({
      where: { userId, status: 'ACTIVE' },
    });
    if (!member)
      throw new ValidationFailedException({
        assignedToId: ['must be an active member of this workspace'],
      });
  }

  /** The timeline a task's linked record shows, resolved without the user's permissions (system view). */
  private async targetOf(task: Task): Promise<TimelineTarget | null> {
    if (!task.entityType || !task.entityId) return null;
    if (task.entityType === 'CUSTOMER') return { customerId: task.entityId };
    if (task.entityType === 'LEAD') return { leadId: task.entityId };
    if (task.entityType === 'ORDER') return { orderId: task.entityId };
    return null;
  }

  private async note(
    target: TimelineTarget,
    task: Task,
    summary: string,
    actorUserId: string,
  ): Promise<void> {
    await this.timeline.record({
      ...target,
      type: 'TASK',
      refType: 'Task',
      refId: task.id,
      summary,
      actorUserId,
    });
  }
}
