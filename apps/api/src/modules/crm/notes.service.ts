import { Injectable } from '@nestjs/common';
import type { Note } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { ValidationFailedException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateNoteDto } from './dto/tasks.dto';
import { EntityLinkRegistry } from './entity-link.registry';
import { TimelineService } from './timeline.service';

export interface NoteDto {
  id: string;
  entityType: string;
  entityId: string;
  kind: string;
  body: string;
  callDirection: string | null;
  callOutcome: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
}

const toDto = (n: Note, createdByName: string | null): NoteDto => ({
  id: n.id,
  entityType: n.entityType,
  entityId: n.entityId,
  kind: n.kind,
  body: n.body,
  callDirection: n.callDirection,
  callOutcome: n.callOutcome,
  createdById: n.createdById,
  createdByName,
  createdAt: n.createdAt.toISOString(),
});

/** Internal notes and call logs on a record. They are never shown to the customer (Requirement 30.2). */
@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly links: EntityLinkRegistry,
    private readonly timeline: TimelineService,
  ) {}

  async list(user: AuthUser, entityType: string, entityId: string): Promise<NoteDto[]> {
    await this.links.resolve(user, entityType, entityId, 'view');
    const notes = await this.prisma.scoped.note.findMany({
      where: { entityType, entityId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    });
    return notes.map((n) =>
      toDto(n, n.createdBy ? `${n.createdBy.firstName} ${n.createdBy.lastName}` : null),
    );
  }

  async create(user: AuthUser, dto: CreateNoteDto): Promise<NoteDto> {
    const kind = dto.kind ?? 'NOTE';
    if (kind === 'NOTE' && (dto.callDirection || dto.callOutcome)) {
      throw new ValidationFailedException({
        kind: ['call direction and outcome belong to call logs'],
      });
    }
    if (kind === 'CALL' && (!dto.callDirection || !dto.callOutcome)) {
      throw new ValidationFailedException({
        callDirection: ['a call log needs a direction and an outcome'],
      });
    }
    const target = await this.links.resolve(user, dto.entityType, dto.entityId, 'edit');

    const note = await this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.note.create({
        data: {
          workspaceId: user.workspaceId,
          entityType: dto.entityType,
          entityId: dto.entityId,
          kind,
          body: dto.body.trim(),
          callDirection: kind === 'CALL' ? (dto.callDirection ?? null) : null,
          callOutcome: kind === 'CALL' ? (dto.callOutcome ?? null) : null,
          createdById: user.userId,
        },
      });
      await this.audit.record(tx, {
        action: kind === 'CALL' ? 'note.call_log' : 'note.create',
        entityType: 'Note',
        entityId: row.id,
        after: { entityType: row.entityType, entityId: row.entityId, kind },
      });
      return row;
    });
    const preview = note.body.length > 120 ? `${note.body.slice(0, 117)}…` : note.body;
    await this.timeline.record({
      ...target,
      type: kind === 'CALL' ? 'CALL' : 'NOTE',
      refType: 'Note',
      refId: note.id,
      summary:
        kind === 'CALL'
          ? `Call (${note.callDirection === 'INBOUND' ? 'incoming' : 'outgoing'}, ${note.callOutcome?.toLowerCase().replace('_', ' ')}): ${preview}`
          : `Note: ${preview}`,
      actorUserId: user.userId,
    });
    return toDto(note, null);
  }
}
