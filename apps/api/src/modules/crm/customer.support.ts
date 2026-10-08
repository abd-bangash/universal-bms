import type { Customer } from '@prisma/client';

export interface CustomerDto {
  id: string;
  fullName: string;
  phones: string[];
  email: string | null;
  billingAddress: unknown;
  shippingAddress: unknown;
  preferredChannel: string | null;
  notes: string | null;
  tags: string[];
  source: string | null;
  channel: string | null;
  campaign: string | null;
  assignedToId: string | null;
  priceListId: string | null;
  status: string;
  customFields: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DuplicateCandidate {
  id: string;
  fullName: string;
  phones: string[];
  email: string | null;
  /** Which rules matched: PHONE, EMAIL or NAME_SIMILAR. */
  reasons: Array<'PHONE' | 'EMAIL' | 'NAME_SIMILAR'>;
}

export const toCustomerDto = (c: Customer): CustomerDto => ({
  id: c.id,
  fullName: c.fullName,
  phones: c.phones,
  email: c.email,
  billingAddress: c.billingAddress,
  shippingAddress: c.shippingAddress,
  preferredChannel: c.preferredChannel,
  notes: c.notes,
  tags: c.tags,
  source: c.source,
  channel: c.channel,
  campaign: c.campaign,
  assignedToId: c.assignedToId,
  priceListId: c.priceListId,
  status: c.status,
  customFields: c.customFields as Record<string, unknown>,
  version: c.version,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

export const cleanTags = (tags: string[] | undefined): string[] | undefined =>
  tags === undefined ? undefined : [...new Set(tags.map((t) => t.trim()).filter((t) => t !== ''))];

/** Digits only, for matching a typed fragment against stored E.164 numbers. */
export const digitsOf = (text: string): string => text.replace(/\D/g, '');
