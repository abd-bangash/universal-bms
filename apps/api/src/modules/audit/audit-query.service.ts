import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { decodeCursor, toPage, type Page } from '../../common/pagination/pagination';
import { ValidationFailedException } from '../../common/errors/app.exception';
import { toAuditEventDto, type AuditEventDto } from './dto/audit-event.dto';
import type { ListAuditEventsQuery } from './dto/list-audit-events.dto';

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Newest first; keyset pagination on (createdAt, id). Scoped to the workspace in context. */
  async list(query: ListAuditEventsQuery): Promise<Page<AuditEventDto>> {
    const filters: Prisma.AuditEventWhereInput[] = [];
    if (query.entityType) filters.push({ entityType: query.entityType });
    if (query.entityId) filters.push({ entityId: query.entityId });
    if (query.actorUserId) filters.push({ actorUserId: query.actorUserId });
    if (query.action) filters.push({ action: query.action });
    if (query.from) filters.push({ createdAt: { gte: new Date(query.from) } });
    if (query.to) filters.push({ createdAt: { lte: new Date(query.to) } });

    if (query.cursor) {
      const { createdAt, id } = decodeCursor(query.cursor);
      if (
        typeof createdAt !== 'string' ||
        typeof id !== 'string' ||
        Number.isNaN(Date.parse(createdAt))
      ) {
        throw new ValidationFailedException({ cursor: ['is not a valid cursor'] });
      }
      const at = new Date(createdAt);
      filters.push({ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] });
    }

    const rows = await this.prisma.scoped.auditEvent.findMany({
      where: { AND: filters },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) => ({
      createdAt: last.createdAt.toISOString(),
      id: last.id,
    })).map(toAuditEventDto);
  }
}
