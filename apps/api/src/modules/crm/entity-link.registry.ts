import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { AppException, ValidationFailedException } from '../../common/errors/app.exception';

/** The records a Task or Note can be attached to (Requirement 30.1). */
export const LINKABLE_ENTITY_TYPES = [
  'CUSTOMER',
  'LEAD',
  'ORDER',
  'QUOTATION',
  'CONVERSATION',
] as const;
export type LinkableEntityType = (typeof LINKABLE_ENTITY_TYPES)[number];

/** Which timeline the entry for a linked record belongs on. */
export interface TimelineTarget {
  customerId?: string;
  leadId?: string;
  orderId?: string;
}

export interface LinkableEntity {
  viewPermission: string;
  editPermission: string;
  /** Finds the record as this user may see it (404 if it is missing, in another workspace, or hidden). */
  resolve(user: AuthUser, id: string): Promise<TimelineTarget>;
}

/**
 * Each module that owns a linkable record registers it. Until a module exists its record type
 * cannot be linked, so a Task never points at something that is not there.
 */
@Injectable()
export class EntityLinkRegistry {
  private readonly entities = new Map<string, LinkableEntity>();

  register(entityType: LinkableEntityType, entity: LinkableEntity): void {
    this.entities.set(entityType, entity);
  }

  /** Throws unless the record exists and the user may use it for `purpose`. */
  async resolve(
    user: AuthUser,
    entityType: string,
    entityId: string,
    purpose: 'view' | 'edit',
    field = 'entityType',
  ): Promise<TimelineTarget> {
    const entity = this.entities.get(entityType);
    if (!entity) {
      throw new ValidationFailedException({
        [field]: [`${entityType.toLowerCase()} records cannot be linked yet`],
      });
    }
    const needed = purpose === 'view' ? entity.viewPermission : entity.editPermission;
    if (!user.permissions.includes(needed)) {
      throw new AppException('PERMISSION_DENIED', 403, 'You do not have permission to do this');
    }
    return entity.resolve(user, entityId);
  }

  has(entityType: string): boolean {
    return this.entities.has(entityType);
  }
}
