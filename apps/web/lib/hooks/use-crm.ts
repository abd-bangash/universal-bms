'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface CustomerView {
  id: string;
  fullName: string;
  phones: string[];
  email: string | null;
  billingAddress: Address | null;
  shippingAddress: Address | null;
  preferredChannel: string | null;
  notes: string | null;
  tags: string[];
  source: string | null;
  channel: string | null;
  campaign: string | null;
  assignedToId: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  customFields: Record<string, unknown>;
  version: number;
}

export interface DuplicateCandidate {
  id: string;
  fullName: string;
  phones: string[];
  email: string | null;
  reasons: Array<'PHONE' | 'EMAIL' | 'NAME_SIMILAR'>;
}

export interface LeadView {
  id: string;
  customerId: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  channel: string | null;
  campaign: string | null;
  interest: string | null;
  productId: string | null;
  requirements: string | null;
  quantity: string | null;
  estimatedValue: string | null;
  quotedAmount: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  stage: string;
  assignedToId: string | null;
  lostReasonId: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  customFields: Record<string, unknown>;
  closedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  allowedTransitions?: Array<{
    to: string;
    requiredPermission: string | null;
    requiredFields: string[];
    requiresApproval: boolean;
  }>;
}

export interface PipelineCard {
  id: string;
  fullName: string;
  phone: string | null;
  interest: string | null;
  estimatedValue: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  assignedToId: string | null;
  nextActionDate: string | null;
}

export interface PipelineColumn {
  stage: string;
  label: string;
  color: string;
  category: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  systemRole: string | null;
  acceptsFrom: string[];
  count: number;
  value: string;
  cards: PipelineCard[];
}

export interface TaskView {
  id: string;
  type: 'CALL' | 'FOLLOW_UP' | 'MEETING' | 'REMINDER' | 'TODO';
  title: string;
  description: string | null;
  dueAt: string | null;
  status: 'OPEN' | 'DONE' | 'CANCELLED';
  assignedToId: string | null;
  entityType: string | null;
  entityId: string | null;
  completedAt: string | null;
}

export interface NoteView {
  id: string;
  kind: 'NOTE' | 'CALL';
  body: string;
  callDirection: 'INBOUND' | 'OUTBOUND' | null;
  callOutcome: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface TimelineEntryView {
  id: string;
  type: string;
  summary: string;
  occurredAt: string;
}

export interface LostReason {
  id: string;
  name: string;
  active: boolean;
}

export interface StaffOption {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
}

export const LOST_REASONS_KEY = ['settings', 'lost-reasons'] as const;

export function useLostReasonsQuery(includeInactive = false) {
  return useQuery({
    queryKey: [...LOST_REASONS_KEY, includeInactive],
    queryFn: ({ signal }) =>
      api.get<LostReason[]>('/settings/lost-reasons', { includeInactive }, signal),
    staleTime: 60_000,
  });
}

/** Active staff, for assignment pickers; only people who may list users can load it. */
export function useStaffQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['staff-options'],
    queryFn: ({ signal }) =>
      api.getPage<StaffOption>('/users', { status: 'ACTIVE', limit: 100 }, signal),
    enabled,
    staleTime: 60_000,
    select: (page) => page.items,
  });
}

export const staffName = (staff: StaffOption[] | undefined, id: string | null): string =>
  id
    ? staff?.find((s) => s.id === id)
      ? `${staff.find((s) => s.id === id)?.firstName} ${staff.find((s) => s.id === id)?.lastName}`
      : ''
    : '';
