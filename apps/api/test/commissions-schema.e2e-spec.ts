import { createTestApp, type TestApp } from './helpers/auth-app';
import { tenantFactories } from './helpers/tenant-factories';

describe('Commissions schema (task 59)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  }, 90_000);
  afterAll(() => t.close());

  const commission = async (ws: string) => {
    const row = await tenantFactories['Commission']!(t.db.prisma, ws);
    return t.db.prisma.commission.findFirstOrThrow({ where: row.where });
  };
  const data = (c: Awaited<ReturnType<typeof commission>>) => ({
    workspaceId: c.workspaceId,
    orderId: c.orderId,
    salespersonId: c.salespersonId,
    ruleSnapshot: {},
    calculationBase: '100',
    amount: '5',
  });

  it('one commission per order, salesperson and line; a per-order row has no line (14.2)', async () => {
    const c = await commission('com-ws-1');
    // the same order and salesperson with no line again: refused, however it is sent
    await expect(t.db.prisma.commission.create({ data: data(c) })).rejects.toThrow(
      /Unique constraint/,
    );
    const item = await t.db.prisma.orderItem.create({
      data: {
        workspaceId: c.workspaceId,
        orderId: c.orderId,
        lineNo: 1,
        name: 'Line',
        quantity: '1',
        listPrice: '10',
        unitPrice: '10',
        lineTotal: '10',
      },
    });
    await t.db.prisma.commission.create({ data: { ...data(c), orderItemId: item.id } });
    await expect(
      t.db.prisma.commission.create({ data: { ...data(c), orderItemId: item.id } }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it('a reversal row may repeat the key, with a negative amount only', async () => {
    const c = await commission('com-ws-2');
    await t.db.prisma.commission.create({
      data: { ...data(c), reversalOfId: c.id, amount: '-2', status: 'REVERSED' },
    });
    await expect(
      t.db.prisma.commission.create({ data: { ...data(c), reversalOfId: c.id, amount: '2' } }),
    ).rejects.toThrow();
    await expect(
      t.db.prisma.commission.update({ where: { id: c.id }, data: { amount: '-1' } }),
    ).rejects.toThrow();
  });

  it('a share is more than 0 and at most 100 percent', async () => {
    const c = await commission('com-ws-3');
    for (const sharePercent of ['0', '100.01', '-5']) {
      await expect(
        t.db.prisma.commission.update({ where: { id: c.id }, data: { sharePercent } }),
      ).rejects.toThrow();
    }
    await t.db.prisma.commission.update({ where: { id: c.id }, data: { sharePercent: '50' } });
  });

  it('paid needs a date, and a decision needs someone who made it', async () => {
    const c = await commission('com-ws-4');
    await expect(
      t.db.prisma.commission.update({ where: { id: c.id }, data: { status: 'PAID' } }),
    ).rejects.toThrow();
    await expect(
      t.db.prisma.commission.update({ where: { id: c.id }, data: { status: 'APPROVED' } }),
    ).rejects.toThrow();
    await t.db.prisma.commission.update({
      where: { id: c.id },
      data: { status: 'APPROVED', approvedById: c.salespersonId, approvedAt: new Date() },
    });
    await t.db.prisma.commission.update({
      where: { id: c.id },
      data: { status: 'PAID', paidAt: new Date(), paidMethod: 'Cash' },
    });
  });

  it('a rule has a non-negative rate and a scope that points at something', async () => {
    const row = await tenantFactories['CommissionRule']!(t.db.prisma, 'com-ws-5');
    const rule = await t.db.prisma.commissionRule.findFirstOrThrow({ where: row.where });
    await expect(
      t.db.prisma.commissionRule.update({ where: { id: rule.id }, data: { rate: '-1' } }),
    ).rejects.toThrow();
    await expect(
      t.db.prisma.commissionRule.update({ where: { id: rule.id }, data: { scope: 'CATEGORY' } }),
    ).rejects.toThrow();
    await expect(
      t.db.prisma.commissionRule.update({ where: { id: rule.id }, data: { scopeId: 'x' } }),
    ).rejects.toThrow();
    await t.db.prisma.commissionRule.update({
      where: { id: rule.id },
      data: { scope: 'ORDER_TYPE', scopeId: 'POS' },
    });
  });
});
