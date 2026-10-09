import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import type { Notification } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { NotFoundAppException } from '../../common/errors/app.exception';
import {
  keysetCursor,
  keysetWhere,
  toPage,
  type Page,
  type PageQueryDto,
} from '../../common/pagination/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  /** Where in the web app the record this is about lives. */
  href: string | null;
  read: boolean;
  createdAt: string;
}

export interface NewNotification {
  type: string;
  title: string;
  body?: string | null;
  entityType?: string;
  entityId?: string;
}

/** Where each kind of record is shown (Requirement 33.4). */
const HREF: Record<string, (id: string) => string> = {
  Lead: (id) => `/leads/${id}`,
  Conversation: (id) => `/conversations?open=${id}`,
  Task: () => '/tasks',
  ProductVariant: () => '/inventory',
  IntegrationConnection: () => '/integrations',
};

const toDto = (n: Notification): NotificationDto => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  href: n.entityType && n.entityId ? (HREF[n.entityType]?.(n.entityId) ?? null) : null,
  read: n.readAt !== null,
  createdAt: n.createdAt.toISOString(),
});

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  /**
   * Tells each of these people. A person who already has an unread notification of the same kind
   * about the same record gets that one refreshed instead of another, so a busy chat is one line in
   * the bell, not fifty.
   */
  async notify(userIds: string[], input: NewNotification): Promise<number> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return 0;
    const workspaceId = this.cls.get('workspaceId');
    if (!workspaceId) throw new Error('No workspace in context');
    let sent = 0;
    for (const userId of unique) {
      const existing =
        input.entityType && input.entityId
          ? await this.prisma.scoped.notification.findFirst({
              where: {
                userId,
                type: input.type,
                entityType: input.entityType,
                entityId: input.entityId,
                readAt: null,
              },
            })
          : null;
      if (existing) {
        await this.prisma.scoped.notification.update({
          where: { id: existing.id },
          data: { title: input.title, body: input.body ?? null, createdAt: new Date() },
        });
      } else {
        await this.prisma.scoped.notification.create({
          data: {
            workspaceId,
            userId,
            type: input.type,
            title: input.title,
            body: input.body ?? null,
            entityType: input.entityType ?? null,
            entityId: input.entityId ?? null,
          },
        });
      }
      sent += 1;
    }
    return sent;
  }

  /** Everyone active whose roles hold the permission (the recipients when a record has no owner, Requirement 33.3). */
  async holdersOf(permission: string): Promise<string[]> {
    const members = await this.prisma.scoped.userWorkspace.findMany({
      where: { status: 'ACTIVE', roles: { some: { role: { permissions: { has: permission } } } } },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  async list(
    user: AuthUser,
    query: PageQueryDto & { unread?: boolean },
  ): Promise<Page<NotificationDto>> {
    const after = keysetWhere('createdAt', 'desc', query.cursor, true);
    const rows = await this.prisma.scoped.notification.findMany({
      where: {
        AND: [
          { userId: user.userId },
          ...(query.unread ? [{ readAt: null }] : []),
          ...(after ? [after as object] : []),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) => keysetCursor(last.createdAt, last.id)).map(toDto);
  }

  async unreadCount(user: AuthUser): Promise<{ count: number }> {
    return {
      count: await this.prisma.scoped.notification.count({
        where: { userId: user.userId, readAt: null },
      }),
    };
  }

  async markRead(user: AuthUser, id: string): Promise<NotificationDto> {
    const row = await this.prisma.scoped.notification.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) throw new NotFoundAppException();
    if (row.readAt) return toDto(row);
    return toDto(
      await this.prisma.scoped.notification.update({ where: { id }, data: { readAt: new Date() } }),
    );
  }

  async readAll(user: AuthUser): Promise<{ marked: number }> {
    const result = await this.prisma.scoped.notification.updateMany({
      where: { userId: user.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: result.count };
  }
}
