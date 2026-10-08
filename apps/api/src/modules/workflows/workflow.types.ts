import type { ScopedTransaction } from '../../common/prisma/prisma.service';

export const WORKFLOW_ENTITY_TYPES = ['LEAD', 'ORDER', 'PURCHASE_ORDER', 'PRODUCTION_JOB'] as const;
export type WorkflowEntityType = (typeof WORKFLOW_ENTITY_TYPES)[number];

export type Tx = ScopedTransaction;

export interface StateView {
  id: string;
  key: string;
  label: string;
  color: string;
  category: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  systemRole: string | null;
  isInitial: boolean;
  sortOrder: number;
  active: boolean;
}

export interface TransitionView {
  from: string;
  to: string;
  requiredPermission: string | null;
  requiredFields: string[];
  requiresApproval: boolean;
}

export interface WorkflowView {
  entityType: WorkflowEntityType;
  name: string;
  states: StateView[];
  transitions: TransitionView[];
}

/** The record being moved, as a module's adapter presents it to the engine. */
export interface WorkflowRecord {
  id: string;
  stateKey: string;
  /** Values that `requiredFields` of a transition are checked against. */
  values: Record<string, unknown>;
}

/** How the engine reads and writes the state of one kind of record. Each owning module registers one. */
export interface WorkflowEntityAdapter {
  entityType: WorkflowEntityType;
  load(tx: Tx, id: string): Promise<WorkflowRecord | null>;
  setState(tx: Tx, id: string, state: StateView): Promise<void>;
  /** The Domain_Event published after the commit, if the entity has one. */
  event?: 'lead.status_changed' | 'order.status_changed';
}

export interface WorkflowActor {
  userId: string | null;
  permissions: readonly string[];
  /** System and AI transitions skip the permission and approval checks of the transition. */
  actorType?: 'USER' | 'SYSTEM' | 'AI';
}

export interface TransitionOptions {
  note?: string;
  actor: WorkflowActor;
  /** Used by the approvals inbox when an approver has already decided (task 97). */
  approved?: boolean;
  /** Extra facts for pre-conditions and side effects, such as the lost reason of a Lead. */
  data?: Record<string, unknown>;
}

export interface TransitionContext {
  tx: Tx;
  entityType: WorkflowEntityType;
  record: WorkflowRecord;
  from: StateView;
  to: StateView;
  actor: WorkflowActor;
  note?: string;
  data: Record<string, unknown>;
}

export type Precondition = (ctx: TransitionContext) => Promise<void>;
export type SideEffect = (ctx: TransitionContext) => Promise<void>;

export type TransitionResult =
  | { pendingApproval: false; entityId: string; from: string; to: string }
  | {
      pendingApproval: true;
      entityId: string;
      from: string;
      to: string;
      approvalRequestId: string;
    };

/** Roles the code attaches behaviour to; a workflow must keep them (Requirement 27.4). */
export const REQUIRED_SYSTEM_ROLES: Record<WorkflowEntityType, readonly string[]> = {
  ORDER: ['DRAFT', 'CONFIRMED', 'DELIVERED', 'COMPLETED', 'CANCELLED'],
  LEAD: ['NEW', 'WON', 'LOST'],
  PURCHASE_ORDER: ['DRAFT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PRODUCTION_JOB: ['QUEUED', 'DONE'],
};

/** Who may approve an approval-required transition of each kind of record. */
export const APPROVER_PERMISSION: Record<WorkflowEntityType, string> = {
  ORDER: 'order:approve',
  PURCHASE_ORDER: 'purchase:approve',
  LEAD: 'workflow:configure',
  PRODUCTION_JOB: 'production:edit',
};
