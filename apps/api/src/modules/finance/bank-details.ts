import type { PrismaService } from '../../common/prisma/prisma.service';

/** One customer-facing account as it appears on a document or in a message. */
export type BankDetail = Record<string, string>;

/**
 * The accounts a customer may be told about: active, switched on for customers, and only the fields
 * of the account that identify it (Requirement 40.2). Nothing else about bank data is stored.
 */
export async function customerFacingAccounts(prisma: PrismaService): Promise<BankDetail[]> {
  const rows = await prisma.scoped.financialAccount.findMany({
    where: { active: true, showToCustomers: true, type: { in: ['BANK', 'MOBILE_WALLET'] } },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  });
  return rows.map((a) => {
    const detail: BankDetail = { Account: a.name };
    if (a.bankName) detail['Bank'] = a.bankName;
    if (a.accountTitle) detail['Account title'] = a.accountTitle;
    if (a.accountNumber) detail['Account number'] = a.accountNumber;
    if (a.branch) detail['Branch'] = a.branch;
    return detail;
  });
}

/** The text a `{{bank_details}}` template variable resolves to (Requirement 40.11). */
export function bankDetailsText(accounts: readonly BankDetail[]): string {
  return accounts
    .map((a) =>
      Object.entries(a)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n'),
    )
    .join('\n\n');
}

/** The name of the template variable that resolves to the customer-facing bank details. */
export const BANK_DETAILS_VARIABLE = 'bank_details';
