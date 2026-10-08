import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import { AppException, NotFoundAppException } from '../../common/errors/app.exception';
import { DomainEventBus } from '../../common/events/domain-event-bus';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowRegistry } from './workflow.registry';
import {
  APPROVER_PERMISSION,
  REQUIRED_SYSTEM_ROLES,
  type StateView,
  type TransitionOptions,
  type TransitionResult,
  type Tx,
  type WorkflowEntityType,
  type WorkflowView,
} from './workflow.types';

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: WorkflowRegistry,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  /** The workflow of this workspace for an entity type, with its states and transitions. */
  async get(entityType: WorkflowEntityType, tx?: Tx): Promise<WorkflowView> {
    const db = tx ?? this.prisma.scoped;
    const workflow = await db.workflow.findFirst({
      where: { entityType },
      include: {
        states: { orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] },
        transitions: { include: { fromState: true, toState: true } },
      },
    });
    if (!workflow) throw new NotFoundAppException(`No workflow is set up for ${entityType}`);
    return {
      entityType,
      name: workflow.name,
      states: workflow.states.map((s) => ({
        id: s.id,
        key: s.key,
        label: s.label,
        color: s.color,
        category: s.category,
        systemRole: s.systemRole,
        isInitial: s.isInitial,
        sortOrder: s.sortOrder,
        active: s.active,
      })),
      transitions: workflow.transitions.map((t) => ({
        from: t.fromState.key,
        to: t.toState.key,
        requiredPermission: t.requiredPermission,
        requiredFields: t.requiredFields,
        requiresApproval: t.requiresApproval,
      })),
    };
  }

  /** The state a new record starts in. */
  async initialState(entityType: WorkflowEntityType, tx?: Tx): Promise<StateView> {
    const workflow = await this.get(entityType, tx);
    const initial = workflow.states.find((s) => s.isInitial && s.active);
    if (!initial)
      throw new AppException('INTERNAL_ERROR', 500, 'The workflow has no initial state');
    return initial;
  }

  /** Keys a record in `fromKey` may move to (active states only). */
  allowedTransitions(workflow: WorkflowView, fromKey: string) {
    return workflow.transitions
      .filter((t) => t.from === fromKey)
      .filter((t) => workflow.states.find((s) => s.key === t.to)?.active)
      .map((t) => ({
        to: t.to,
        requiredPermission: t.requiredPermission,
        requiredFields: t.requiredFields,
        requiresApproval: t.requiresApproval,
      }));
  }

  /**
   * Moves a record to another state (design.md Workflows, steps 1-6):
   * 1 find the transition (422 with the allowed keys if none), 2 check permission and required
   * fields, 3 create an approval request instead when one is needed, 4 run the pre-conditions of the
   * target System_Role, 5 in ONE transaction change the state, write the history, run the side
   * effects and audit, 6 publish the event after the commit.
   */
  async transition(
    entityType: WorkflowEntityType,
    entityId: string,
    toKey: string,
    options: TransitionOptions,
  ): Promise<TransitionResult> {
    const adapter = this.registry.adapter(entityType);
    if (!adapter)
      throw new AppException('INTERNAL_ERROR', 500, `No ${entityType} adapter is registered`);
    const workspaceId = this.requireWorkspace();
    const actor = options.actor;
    const systemActor = actor.actorType === 'SYSTEM' || actor.actorType === 'AI';

    let changed: { from: StateView; to: StateView } | null = null;
    const result = await this.prisma.scoped.$transaction(async (tx): Promise<TransitionResult> => {
      const record = await adapter.load(tx, entityId);
      if (!record) throw new NotFoundAppException();
      const workflow = await this.get(entityType, tx);
      const from = workflow.states.find((s) => s.key === record.stateKey);
      const to = workflow.states.find((s) => s.key === toKey && s.active);

      // 1. is there such a transition?
      const allowed = this.allowedTransitions(workflow, record.stateKey);
      const transition = to
        ? workflow.transitions.find((t) => t.from === record.stateKey && t.to === toKey)
        : undefined;
      if (!from || !to || !transition) {
        throw new AppException(
          'TRANSITION_NOT_ALLOWED',
          422,
          `Cannot move from "${record.stateKey}" to "${toKey}"`,
          { allowed: allowed.map((a) => a.to) },
          { allowed },
        );
      }

      // 2. permission and required fields
      if (
        !systemActor &&
        transition.requiredPermission &&
        !actor.permissions.includes(transition.requiredPermission)
      ) {
        throw new AppException('PERMISSION_DENIED', 403, 'You do not have permission to do this');
      }
      const missing = transition.requiredFields.filter((f) =>
        isEmpty({ ...record.values, ...options.data }[f]),
      );
      if (missing.length > 0) {
        throw new AppException(
          'VALIDATION_FAILED',
          422,
          'Some information is needed before this change',
          Object.fromEntries(missing.map((f) => [f, ['is required for this change']])),
        );
      }

      // 3. approval
      if (
        transition.requiresApproval &&
        !options.approved &&
        !systemActor &&
        !actor.permissions.includes(APPROVER_PERMISSION[entityType])
      ) {
        if (!actor.userId)
          throw new AppException(
            'PERMISSION_DENIED',
            403,
            'An approval needs a person to ask for it',
          );
        const request = await tx.approvalRequest.create({
          data: {
            workspaceId,
            type: 'WORKFLOW_TRANSITION',
            entityType,
            entityId,
            payload: { from: record.stateKey, to: toKey, note: options.note ?? null },
            requestedById: actor.userId,
          },
        });
        await this.audit.record(tx, {
          action: `${entityType.toLowerCase()}.approval_requested`,
          entityType,
          entityId,
          after: { from: record.stateKey, to: toKey, approvalRequestId: request.id },
        });
        return {
          pendingApproval: true,
          entityId,
          from: record.stateKey,
          to: toKey,
          approvalRequestId: request.id,
        };
      }

      // 4. pre-conditions of the target role, 5. the change itself
      const ctx = {
        tx,
        entityType,
        record,
        from,
        to,
        actor,
        note: options.note,
        data: options.data ?? {},
      };
      for (const check of this.registry.preconditionsFor(entityType, to.systemRole))
        await check(ctx);

      await adapter.setState(tx, entityId, to);
      await tx.statusHistory.create({
        data: {
          workspaceId,
          entityType,
          entityId,
          fromKey: from.key,
          toKey: to.key,
          changedById: actor.userId,
          actorType: actor.actorType ?? 'USER',
          note: options.note ?? null,
        },
      });
      for (const effect of this.registry.sideEffectsFor(entityType, to.systemRole))
        await effect(ctx);
      await this.audit.record(tx, {
        action: `${entityType.toLowerCase()}.status_changed`,
        entityType,
        entityId,
        before: { state: from.key },
        after: { state: to.key },
      });
      changed = { from, to };
      return { pendingApproval: false, entityId, from: from.key, to: to.key };
    });

    // 6. only after the commit
    if (changed && adapter.event) {
      await this.publish(adapter.event, workspaceId, entityId, actor.userId);
    }
    return result;
  }

  /** Whether a workflow still has every System_Role the code relies on (used by the R4 editor). */
  missingSystemRoles(workflow: Pick<WorkflowView, 'entityType' | 'states'>): string[] {
    const present = new Set(workflow.states.filter((s) => s.active).map((s) => s.systemRole));
    return REQUIRED_SYSTEM_ROLES[workflow.entityType].filter((role) => !present.has(role));
  }

  private async publish(
    event: 'lead.status_changed' | 'order.status_changed',
    workspaceId: string,
    entityId: string,
    actorUserId: string | null,
  ): Promise<void> {
    if (event === 'lead.status_changed') {
      await this.events.publish(event, { workspaceId, leadId: entityId, actorUserId });
    } else {
      await this.events.publish(event, { workspaceId, orderId: entityId, actorUserId });
    }
  }

  private requireWorkspace(): string {
    const id = this.cls.get('workspaceId');
    if (!id) throw new Error('No workspace in context');
    return id;
  }
}
