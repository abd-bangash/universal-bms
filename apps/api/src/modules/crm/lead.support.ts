import type { Lead } from '@prisma/client';

export interface LeadDto {
  id: string;
  customerId: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  channel: string | null;
  campaign: string | null;
  adId: string | null;
  formId: string | null;
  interest: string | null;
  productId: string | null;
  requirements: string | null;
  quantity: string | null;
  estimatedValue: string | null;
  quotedAmount: string | null;
  priority: string;
  stage: string;
  assignedToId: string | null;
  lostReasonId: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  customFields: Record<string, unknown>;
  closedAt: string | null;
  version: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

const str = (d: { toFixed(): string } | null): string | null => (d === null ? null : d.toFixed());

export const toLeadDto = (l: Lead): LeadDto => ({
  id: l.id,
  customerId: l.customerId,
  fullName: l.fullName,
  phone: l.phone,
  email: l.email,
  source: l.source,
  channel: l.channel,
  campaign: l.campaign,
  adId: l.adId,
  formId: l.formId,
  interest: l.interest,
  productId: l.productId,
  requirements: l.requirements,
  quantity: str(l.quantity),
  estimatedValue: str(l.estimatedValue),
  quotedAmount: str(l.quotedAmount),
  priority: l.priority,
  stage: l.stage,
  assignedToId: l.assignedToId,
  lostReasonId: l.lostReasonId,
  nextAction: l.nextAction,
  nextActionDate: l.nextActionDate ? l.nextActionDate.toISOString() : null,
  customFields: l.customFields as Record<string, unknown>,
  closedAt: l.closedAt ? l.closedAt.toISOString() : null,
  version: l.version,
  createdById: l.createdById,
  createdAt: l.createdAt.toISOString(),
  updatedAt: l.updatedAt.toISOString(),
});

/** Fields whose change is worth a line in the lead's history (Requirement 9.3). */
export const KEY_FIELDS: Array<{ field: keyof LeadDto; label: string }> = [
  { field: 'fullName', label: 'Name' },
  { field: 'phone', label: 'Phone' },
  { field: 'email', label: 'Email' },
  { field: 'productId', label: 'Interested product' },
  { field: 'interest', label: 'Interest' },
  { field: 'quantity', label: 'Quantity' },
  { field: 'estimatedValue', label: 'Estimated value' },
  { field: 'quotedAmount', label: 'Quoted amount' },
  { field: 'priority', label: 'Priority' },
  { field: 'nextAction', label: 'Next action' },
  { field: 'nextActionDate', label: 'Follow-up date' },
];
