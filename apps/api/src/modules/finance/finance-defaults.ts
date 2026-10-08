import type { IndustryProfileDefinition } from '@bms/validators';
import type { Tx } from '../tenants/registries';

export const DEFAULT_ACCOUNTS = [
  { type: 'CASH', name: 'Cash' },
  { type: 'BANK', name: 'Bank account' },
  { type: 'CARD_TERMINAL', name: 'Card terminal' },
  { type: 'MOBILE_WALLET', name: 'Mobile wallet' },
] as const;

/** Each payment method pays into one account; bank and wallet payments carry a reference number. */
export const DEFAULT_METHODS = [
  { name: 'Cash', type: 'CASH', account: 'Cash', requiresReference: false },
  {
    name: 'Bank transfer',
    type: 'BANK_TRANSFER',
    account: 'Bank account',
    requiresReference: true,
  },
  { name: 'Card', type: 'CARD', account: 'Card terminal', requiresReference: false },
  { name: 'Mobile money', type: 'MOBILE_MONEY', account: 'Mobile wallet', requiresReference: true },
] as const;

/**
 * Every workspace starts with a cash account, a bank account, a card terminal and a mobile wallet,
 * and the four payment methods that pay into them (Requirement 13.1). Running it twice, or on a
 * workspace that renamed or added things, changes nothing that is already there.
 */
export async function ensureFinanceDefaults(tx: Tx, workspaceId: string): Promise<void> {
  const accounts = new Map<string, string>();
  for (const def of DEFAULT_ACCOUNTS) {
    const existing = await tx.financialAccount.findFirst({
      where: { workspaceId, name: def.name },
    });
    const row = existing ?? (await tx.financialAccount.create({ data: { workspaceId, ...def } }));
    accounts.set(def.name, row.id);
  }
  for (const def of DEFAULT_METHODS) {
    const existing = await tx.paymentMethod.findFirst({ where: { workspaceId, name: def.name } });
    if (existing) continue;
    await tx.paymentMethod.create({
      data: {
        workspaceId,
        name: def.name,
        type: def.type,
        accountId: accounts.get(def.account) as string,
        requiresReference: def.requiresReference,
      },
    });
  }
}

/** The profile's `expenseCategories` section; categories a business added or switched off are left alone. */
export async function applyProfileExpenseCategories(
  tx: Tx,
  workspaceId: string,
  items: unknown,
): Promise<void> {
  for (const name of (items ?? []) as IndustryProfileDefinition['expenseCategories']) {
    const existing = await tx.expenseCategory.findFirst({
      where: { workspaceId, name: { equals: name, mode: 'insensitive' } },
    });
    if (!existing) await tx.expenseCategory.create({ data: { workspaceId, name } });
  }
}
