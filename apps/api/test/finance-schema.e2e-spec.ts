import { PrismaService } from '../src/common/prisma/prisma.service';
import { ensureFinanceDefaults } from '../src/modules/finance/finance-defaults';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { createTestApp, type TestApp } from './helpers/auth-app';
import { tenantFactories } from './helpers/tenant-factories';

describe('Finance schema and workspace defaults (task 39)', () => {
  let t: TestApp;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp();
  }, 90_000);
  afterAll(() => t.close());

  async function workspace() {
    return t.app.get(TenantsService).createWorkspace({
      name: `Finance ${++n}`,
      industryProfile: 'furniture',
      owner: {
        email: `owner${n}@finance.test`,
        firstName: 'O',
        lastName: 'O',
        password: 'owner-password-1',
      },
    });
  }

  it('a new workspace gets cash, bank, card and wallet accounts and the four payment methods (13.1)', async () => {
    const { workspaceId } = await workspace();
    const accounts = await t.db.prisma.financialAccount.findMany({ where: { workspaceId } });
    expect(accounts.map((a) => a.type).sort()).toEqual(
      ['BANK', 'CARD_TERMINAL', 'CASH', 'MOBILE_WALLET'].sort(),
    );
    expect(accounts.every((a) => a.active && !a.showToCustomers)).toBe(true);
    const methods = await t.db.prisma.paymentMethod.findMany({
      where: { workspaceId },
      include: { account: true },
    });
    expect(methods.map((m) => m.name).sort()).toEqual(
      ['Bank transfer', 'Card', 'Cash', 'Mobile money'].sort(),
    );
    const byName = Object.fromEntries(methods.map((m) => [m.name, m]));
    expect(byName['Cash']?.account.type).toBe('CASH');
    expect(byName['Bank transfer']).toMatchObject({ requiresReference: true });
    expect(byName['Cash']).toMatchObject({ requiresReference: false });
  });

  it('applies the profile expense categories', async () => {
    const { workspaceId } = await workspace();
    const names = (await t.db.prisma.expenseCategory.findMany({ where: { workspaceId } })).map(
      (c) => c.name,
    );
    expect(names).toEqual(expect.arrayContaining(['Raw materials', 'Rent', 'Other']));
  });

  it('running the defaults again changes nothing, and keeps what the business renamed', async () => {
    const { workspaceId } = await workspace();
    await t.db.prisma.financialAccount.updateMany({
      where: { workspaceId, name: 'Bank account' },
      data: { name: 'HBL current', showToCustomers: true },
    });
    const prisma = t.app.get(PrismaService);
    await prisma.unscoped.$transaction((tx) => ensureFinanceDefaults(tx, workspaceId));
    await prisma.unscoped.$transaction((tx) => ensureFinanceDefaults(tx, workspaceId));
    const accounts = await t.db.prisma.financialAccount.findMany({ where: { workspaceId } });
    // the renamed account stays; the default name is filled in again beside it
    expect(accounts.map((a) => a.name)).toEqual(
      expect.arrayContaining(['Cash', 'HBL current', 'Bank account']),
    );
    expect(await t.db.prisma.paymentMethod.count({ where: { workspaceId } })).toBe(4);
  });

  it('money rows are positive, and a payment that moves money names its method and account', async () => {
    const payment = await tenantFactories['Payment']!(t.db.prisma, 'finance-ws');
    const base = await t.db.prisma.payment.findFirstOrThrow({ where: payment.where });
    const data = {
      workspaceId: base.workspaceId,
      orderId: base.orderId,
      customerId: base.customerId,
    };
    await expect(
      t.db.prisma.payment.create({
        data: {
          ...data,
          paymentNumber: 'X-1',
          type: 'DEPOSIT',
          amount: '0',
          paymentMethodId: base.paymentMethodId,
          accountId: base.accountId,
        },
      }),
    ).rejects.toThrow(/payments_amount_positive/);
    await expect(
      t.db.prisma.payment.create({
        data: { ...data, paymentNumber: 'X-2', type: 'DEPOSIT', amount: '5' },
      }),
    ).rejects.toThrow(/payments_method_unless_credit/);
    await expect(
      t.db.prisma.payment.create({
        data: {
          workspaceId: base.workspaceId,
          paymentNumber: 'X-3',
          type: 'ADVANCE',
          amount: '5',
          paymentMethodId: base.paymentMethodId,
          accountId: base.accountId,
        },
      }),
    ).rejects.toThrow(/payments_has_subject/);
    // applied credit moves no money, so it needs no method
    await t.db.prisma.payment.create({
      data: { ...data, paymentNumber: 'X-4', type: 'CREDIT_APPLIED', amount: '5' },
    });
    // payment numbers are unique within a workspace
    await expect(
      t.db.prisma.payment.create({
        data: {
          ...data,
          paymentNumber: base.paymentNumber,
          type: 'DEPOSIT',
          amount: '5',
          paymentMethodId: base.paymentMethodId,
          accountId: base.accountId,
        },
      }),
    ).rejects.toThrow();
  });
});
