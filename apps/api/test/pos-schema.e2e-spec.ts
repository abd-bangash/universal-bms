import { createTestApp, type TestApp } from './helpers/auth-app';
import { tenantFactories } from './helpers/tenant-factories';

describe('POS schema (task 50)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  }, 90_000);
  afterAll(() => t.close());

  const session = async (ws: string) => {
    const row = await tenantFactories['PosSession']!(t.db.prisma, ws);
    return t.db.prisma.posSession.findFirstOrThrow({ where: row.where });
  };

  it('a cashier has at most one open session, but may have many closed ones (12.1)', async () => {
    const open = await session('pos-ws-1');
    await expect(
      t.db.prisma.posSession.create({
        data: {
          workspaceId: open.workspaceId,
          cashierId: open.cashierId,
          locationId: open.locationId,
        },
      }),
    ).rejects.toThrow(/Unique constraint/);
    await t.db.prisma.posSession.update({
      where: { id: open.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await t.db.prisma.posSession.create({
      data: {
        workspaceId: open.workspaceId,
        cashierId: open.cashierId,
        locationId: open.locationId,
      },
    });
    // a second closed one is fine too
    await t.db.prisma.posSession.create({
      data: {
        workspaceId: open.workspaceId,
        cashierId: open.cashierId,
        locationId: open.locationId,
        status: 'CLOSED',
        closedAt: new Date(),
      },
    });
    expect(
      await t.db.prisma.posSession.count({ where: { cashierId: open.cashierId, status: 'OPEN' } }),
    ).toBe(1);
  });

  it('another cashier, or another workspace, can have an open session at the same time', async () => {
    const a = await session('pos-ws-2');
    const b = await session('pos-ws-3');
    expect(a.status).toBe('OPEN');
    expect(b.status).toBe('OPEN');
  });

  it('a session is closed exactly when it has a closing time', async () => {
    const s = await session('pos-ws-4');
    await expect(
      t.db.prisma.posSession.update({ where: { id: s.id }, data: { status: 'CLOSED' } }),
    ).rejects.toThrow(/pos_sessions_closed_has_time/);
    await expect(
      t.db.prisma.posSession.update({ where: { id: s.id }, data: { closedAt: new Date() } }),
    ).rejects.toThrow(/pos_sessions_closed_has_time/);
    await expect(
      t.db.prisma.posSession.update({ where: { id: s.id }, data: { status: 'PAUSED' } }),
    ).rejects.toThrow();
  });

  it('cash movements go in or out by a positive amount', async () => {
    const s = await session('pos-ws-5');
    const data = { workspaceId: s.workspaceId, posSessionId: s.id, reason: 'Float' };
    await t.db.prisma.cashMovement.create({ data: { ...data, direction: 'OUT', amount: '50' } });
    await expect(
      t.db.prisma.cashMovement.create({ data: { ...data, direction: 'SIDEWAYS', amount: '50' } }),
    ).rejects.toThrow();
    await expect(
      t.db.prisma.cashMovement.create({ data: { ...data, direction: 'IN', amount: '0' } }),
    ).rejects.toThrow(/cash_movements_amount_positive/);
  });

  it('orders and payments can point at a session', async () => {
    const s = await session('pos-ws-6');
    const order = await tenantFactories['Order']!(t.db.prisma, s.workspaceId);
    const row = await t.db.prisma.order.findFirstOrThrow({ where: order.where });
    await t.db.prisma.order.update({ where: { id: row.id }, data: { posSessionId: s.id } });
    await expect(
      t.db.prisma.order.update({ where: { id: row.id }, data: { posSessionId: 'missing' } }),
    ).rejects.toThrow();
  });
});
