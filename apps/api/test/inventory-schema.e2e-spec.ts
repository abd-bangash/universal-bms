import { TenantsService } from '../src/modules/tenants/tenants.service';
import { createTestApp, type TestApp } from './helpers/auth-app';
import { tenantFactories } from './helpers/tenant-factories';

describe('Inventory schema and workspace defaults (task 45)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  }, 90_000);
  afterAll(() => t.close());

  it('a new workspace has the default adjustment reasons', async () => {
    const { workspaceId } = await t.app.get(TenantsService).createWorkspace({
      name: 'Inventory defaults',
      industryProfile: 'furniture',
      owner: {
        email: 'o@inv-schema.test',
        firstName: 'O',
        lastName: 'O',
        password: 'owner-password-1',
      },
    });
    const names = (await t.db.prisma.adjustmentReason.findMany({ where: { workspaceId } })).map(
      (r) => r.name,
    );
    expect(names.sort()).toEqual(
      [
        'Counting correction',
        'Damaged',
        'Found',
        'Lost or stolen',
        'Other',
        'Returned to stock',
      ].sort(),
    );
  });

  it('the stock ledger cannot be changed or deleted (37.9)', async () => {
    const row = await tenantFactories['StockMovement']!(t.db.prisma, 'inv-ws');
    const movement = await t.db.prisma.stockMovement.findFirstOrThrow({ where: row.where });
    await expect(
      t.db.prisma.stockMovement.update({
        where: { id: movement.id },
        data: { quantityDelta: '99' },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(t.db.prisma.stockMovement.delete({ where: { id: movement.id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(
      t.db.prisma.$executeRaw`DELETE FROM stock_movements WHERE id = ${movement.id}`,
    ).rejects.toThrow(/append-only/);
    expect(
      (
        await t.db.prisma.stockMovement.findFirstOrThrow({ where: { id: movement.id } })
      ).quantityDelta.toFixed(),
    ).toBe('5');
  });

  it('a movement always moves something in the direction of its type', async () => {
    const row = await tenantFactories['StockMovement']!(t.db.prisma, 'inv-ws-2');
    const m = await t.db.prisma.stockMovement.findFirstOrThrow({ where: row.where });
    const data = { workspaceId: m.workspaceId, variantId: m.variantId, locationId: m.locationId };
    await expect(
      t.db.prisma.stockMovement.create({
        data: { ...data, movementType: 'ADJUSTMENT_IN', quantityDelta: '0' },
      }),
    ).rejects.toThrow();
    await expect(
      t.db.prisma.stockMovement.create({
        data: { ...data, movementType: 'ADJUSTMENT_IN', quantityDelta: '-3' },
      }),
    ).rejects.toThrow(/stock_movements_direction/);
    await expect(
      t.db.prisma.stockMovement.create({
        data: { ...data, movementType: 'SALE', quantityDelta: '3' },
      }),
    ).rejects.toThrow(/stock_movements_direction/);
    await t.db.prisma.stockMovement.create({
      data: { ...data, movementType: 'SALE', quantityDelta: '-3' },
    });
  });

  it('there is one level per variant and location, and reservations are never negative', async () => {
    const row = await tenantFactories['StockLevel']!(t.db.prisma, 'inv-ws-3');
    const level = await t.db.prisma.stockLevel.findFirstOrThrow({ where: row.where });
    await expect(
      t.db.prisma.stockLevel.create({
        data: {
          workspaceId: level.workspaceId,
          variantId: level.variantId,
          locationId: level.locationId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      t.db.prisma.stockLevel.update({ where: { id: level.id }, data: { reserved: '-1' } }),
    ).rejects.toThrow(/stock_levels_reserved_nonnegative/);
    // on hand may go below zero: whether that is allowed is a workspace setting
    await t.db.prisma.stockLevel.update({ where: { id: level.id }, data: { onHand: '-2' } });
  });
});
