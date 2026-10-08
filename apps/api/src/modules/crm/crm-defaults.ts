import type { IndustryProfileDefinition } from '@bms/validators';
import type { Tx } from '../tenants/registries';

export const WALK_IN_NAME = 'Walk-in customer';

/**
 * Every workspace has exactly one walk-in Customer, used for anonymous counter sales
 * (Requirement 12.10). Creating it twice is harmless.
 */
export async function ensureWalkInCustomer(tx: Tx, workspaceId: string): Promise<void> {
  const existing = await tx.customer.findFirst({ where: { workspaceId, isWalkIn: true } });
  if (!existing) {
    await tx.customer.create({
      data: { workspaceId, fullName: WALK_IN_NAME, isWalkIn: true },
    });
  }
}

/** The profile's `lostReasons` section; reasons a business added or deactivated are left alone. */
export async function applyProfileLostReasons(
  tx: Tx,
  workspaceId: string,
  items: unknown,
): Promise<void> {
  for (const name of (items ?? []) as IndustryProfileDefinition['lostReasons']) {
    const existing = await tx.lostReason.findFirst({
      where: { workspaceId, name: { equals: name, mode: 'insensitive' } },
    });
    if (!existing) await tx.lostReason.create({ data: { workspaceId, name } });
  }
}
