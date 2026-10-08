import { Injectable } from '@nestjs/common';
import type {
  Precondition,
  SideEffect,
  WorkflowEntityAdapter,
  WorkflowEntityType,
} from './workflow.types';

/**
 * Modules register here what the engine needs from them: one adapter per entity type, and the
 * business rules attached to System_Roles (never to labels or keys, Requirement 27.3).
 */
@Injectable()
export class WorkflowRegistry {
  private readonly adapters = new Map<WorkflowEntityType, WorkflowEntityAdapter>();
  private readonly preconditions = new Map<string, Precondition[]>();
  private readonly sideEffects = new Map<string, SideEffect[]>();

  registerAdapter(adapter: WorkflowEntityAdapter): void {
    this.adapters.set(adapter.entityType, adapter);
  }

  adapter(entityType: WorkflowEntityType): WorkflowEntityAdapter | undefined {
    return this.adapters.get(entityType);
  }

  /** Runs before the state changes; throwing refuses the transition and rolls everything back. */
  registerPrecondition(entityType: WorkflowEntityType, systemRole: string, fn: Precondition): void {
    this.add(this.preconditions, entityType, systemRole, fn);
  }

  /** Runs inside the same transaction as the state change, after it. */
  registerSideEffect(entityType: WorkflowEntityType, systemRole: string, fn: SideEffect): void {
    this.add(this.sideEffects, entityType, systemRole, fn);
  }

  preconditionsFor(entityType: WorkflowEntityType, systemRole: string | null): Precondition[] {
    return systemRole ? (this.preconditions.get(key(entityType, systemRole)) ?? []) : [];
  }

  sideEffectsFor(entityType: WorkflowEntityType, systemRole: string | null): SideEffect[] {
    return systemRole ? (this.sideEffects.get(key(entityType, systemRole)) ?? []) : [];
  }

  private add<T>(map: Map<string, T[]>, entityType: WorkflowEntityType, role: string, fn: T) {
    map.set(key(entityType, role), [...(map.get(key(entityType, role)) ?? []), fn]);
  }
}

const key = (entityType: WorkflowEntityType, role: string) => `${entityType}:${role}`;
