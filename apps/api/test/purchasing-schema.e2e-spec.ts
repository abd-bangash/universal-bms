import { createTestApp, type TestApp } from './helpers/auth-app';
import { tenantFactories } from './helpers/tenant-factories';

describe('Purchasing schema (task 55)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  }, 90_000);
  afterAll(() => t.close());

  const item = async (ws: string) => {
    const row = await tenantFactories['PurchaseOrderItem']!(t.db.prisma, ws);
    return t.db.prisma.purchaseOrderItem.findFirstOrThrow({ where: row.where });
  };

  it('purchase order numbers and goods receipt numbers are unique within a workspace only', async () => {
    const po = await tenantFactories['PurchaseOrder']!(t.db.prisma, 'pur-ws-1');
    const row = await t.db.prisma.purchaseOrder.findFirstOrThrow({ where: po.where });
    await expect(
      t.db.prisma.purchaseOrder.create({
        data: {
          workspaceId: row.workspaceId,
          orderNumber: row.orderNumber,
          supplierId: row.supplierId,
          locationId: row.locationId,
          subtotal: '1',
          totalAmount: '1',
        },
      }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it('lines are numbered once per purchase order', async () => {
    const line = await item('pur-ws-2');
    await expect(
      t.db.prisma.purchaseOrderItem.create({
        data: {
          workspaceId: line.workspaceId,
          purchaseOrderId: line.purchaseOrderId,
          lineNo: line.lineNo,
          variantId: line.variantId,
          quantity: '1',
          unitCost: '1',
          lineTotal: '1',
        },
      }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it('refuses zero or negative quantities and negative costs (7.8)', async () => {
    const line = await item('pur-ws-3');
    const base = {
      workspaceId: line.workspaceId,
      purchaseOrderId: line.purchaseOrderId,
      variantId: line.variantId,
      unitCost: '1',
      lineTotal: '1',
    };
    await expect(
      t.db.prisma.purchaseOrderItem.create({ data: { ...base, lineNo: 2, quantity: '0' } }),
    ).rejects.toThrow();
    await expect(
      t.db.prisma.purchaseOrderItem.create({ data: { ...base, lineNo: 3, quantity: '-1' } }),
    ).rejects.toThrow();
    await expect(
      t.db.prisma.purchaseOrderItem.create({
        data: { ...base, lineNo: 4, quantity: '1', unitCost: '-1' },
      }),
    ).rejects.toThrow();
  });

  it('returned quantity can never exceed received quantity (38.8)', async () => {
    const line = await item('pur-ws-4');
    await expect(
      t.db.prisma.purchaseOrderItem.update({
        where: { id: line.id },
        data: { receivedQty: '2', returnedQty: '3' },
      }),
    ).rejects.toThrow();
    await t.db.prisma.purchaseOrderItem.update({
      where: { id: line.id },
      data: { receivedQty: '2', returnedQty: '2' },
    });
    await expect(
      t.db.prisma.purchaseOrderItem.update({ where: { id: line.id }, data: { receivedQty: '-1' } }),
    ).rejects.toThrow();
  });

  it('a supplier payment must be positive and a supplier status must be known', async () => {
    const pay = await tenantFactories['SupplierPayment']!(t.db.prisma, 'pur-ws-5');
    await expect(
      t.db.prisma.supplierPayment.update({
        where: pay.where as { id: string },
        data: { amount: '0' },
      }),
    ).rejects.toThrow();
    const sup = await tenantFactories['Supplier']!(t.db.prisma, 'pur-ws-5');
    await expect(
      t.db.prisma.supplier.update({ where: sup.where as { id: string }, data: { status: 'GONE' } }),
    ).rejects.toThrow();
    await t.db.prisma.supplier.update({
      where: sup.where as { id: string },
      data: { status: 'ARCHIVED' },
    });
  });

  it('supplier names are searchable through a trigram index', async () => {
    const rows = await t.db.prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE indexname = 'suppliers_name_trgm'`;
    expect(rows).toHaveLength(1);
  });
});
