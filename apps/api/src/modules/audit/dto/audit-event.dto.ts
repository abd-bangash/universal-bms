import type { AuditEvent } from '@prisma/client';

export interface AuditEventDto {
  id: string;
  actorUserId: string | null;
  actorType: string;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousState: unknown;
  newState: unknown;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

export function toAuditEventDto(event: AuditEvent): AuditEventDto {
  return {
    id: event.id,
    actorUserId: event.actorUserId,
    actorType: event.actorType,
    actorRole: event.actorRole,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    previousState: event.previousState,
    newState: event.newState,
    metadata: event.metadata,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    requestId: event.requestId,
    createdAt: event.createdAt.toISOString(),
  };
}
