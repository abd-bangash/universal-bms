import type { Tx } from '../tenants/registries';

/** Why stock is adjusted by hand; a business can add its own and switch these off (Requirement 7.5). */
export const DEFAULT_ADJUSTMENT_REASONS = [
  'Damaged',
  'Lost or stolen',
  'Found',
  'Counting correction',
  'Returned to stock',
  'Other',
] as const;

/** Creates the reasons a workspace is missing; ones it renamed or switched off are left alone. */
export async function ensureAdjustmentReasons(tx: Tx, workspaceId: string): Promise<void> {
  for (const name of DEFAULT_ADJUSTMENT_REASONS) {
    const existing = await tx.adjustmentReason.findFirst({
      where: { workspaceId, name: { equals: name, mode: 'insensitive' } },
    });
    if (!existing) await tx.adjustmentReason.create({ data: { workspaceId, name } });
  }
}
