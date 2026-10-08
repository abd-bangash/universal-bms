import { migrationFile, runScript } from './helpers/sql';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';

describe('Migrations (real PostgreSQL)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  }, 60_000);
  afterAll(() => db.drop());

  const tables = async () =>
    (
      await db.prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY table_name`
    ).map((r) => r.table_name);

  const extensions = async () =>
    (
      await db.prisma.$queryRaw<Array<{ extname: string }>>`
        SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm', 'citext') ORDER BY extname`
    ).map((r) => r.extname);

  it('0001 creates the extensions, 0002 the 27 core tables and 0003 the 8 catalog tables 0004 the 4 CRM tables and 0006 the 9 sales tables, and 0008 the 7 finance tables and 0009 the 6 inventory tables and 0010 the 2 POS tables and 0011 the 6 purchasing tables', async () => {
    expect(await extensions()).toEqual(['citext', 'pg_trgm']);
    const names = await tables();
    expect(names).toHaveLength(69);
    expect(names).toEqual(
      expect.arrayContaining([
        'workspaces',
        'audit_events',
        'users',
        'tasks',
        'products',
        'price_lists',
      ]),
    );
  });

  it('names every table and column in snake_case', async () => {
    const bad = await db.prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
        AND (column_name ~ '[A-Z]' OR table_name ~ '[A-Z]')`;
    expect(bad).toEqual([]);
  });

  it('only one default location per workspace', async () => {
    await db.prisma.workspace.create({
      data: { id: 'w1', name: 'W', slug: 'w1', industryProfile: 'furniture' },
    });
    await db.prisma.inventoryLocation.create({
      data: { workspaceId: 'w1', name: 'Main', isDefault: true },
    });
    await db.prisma.inventoryLocation.create({
      data: { workspaceId: 'w1', name: 'Other', isDefault: false },
    });
    await expect(
      db.prisma.inventoryLocation.create({
        data: { workspaceId: 'w1', name: 'Second', isDefault: true },
      }),
    ).rejects.toThrow();
  });

  it('uniqueness is per workspace, not global', async () => {
    await db.prisma.workspace.create({
      data: { id: 'w2', name: 'W2', slug: 'w2', industryProfile: 'furniture' },
    });
    await db.prisma.unit.create({
      data: { workspaceId: 'w1', name: 'Piece', symbol: 'pc', dimension: 'count', toBase: '1' },
    });
    await db.prisma.unit.create({
      data: { workspaceId: 'w2', name: 'Piece', symbol: 'pc', dimension: 'count', toBase: '1' },
    });
    await expect(
      db.prisma.unit.create({
        data: { workspaceId: 'w1', name: 'Piece 2', symbol: 'pc', dimension: 'count', toBase: '1' },
      }),
    ).rejects.toThrow();
  });

  it('catalog: SKU and barcode are unique per workspace, root category names and defaults are enforced', async () => {
    const mk = (workspaceId: string, code: string) =>
      db.prisma.product.create({ data: { workspaceId, code, name: code, basePrice: '10' } });
    const p1 = await mk('w1', 'P1');
    const p2 = await mk('w1', 'P2');
    const p3 = await mk('w2', 'P3');
    const variant = (workspaceId: string, productId: string, sku: string, extra = {}) =>
      db.prisma.productVariant.create({ data: { workspaceId, productId, sku, ...extra } });

    await variant('w1', p1.id, 'SKU-1', { barcode: '111', isDefault: true });
    await expect(variant('w1', p2.id, 'SKU-1')).rejects.toThrow();
    await expect(variant('w1', p2.id, 'SKU-2', { barcode: '111' })).rejects.toThrow();
    await variant('w2', p3.id, 'SKU-1', { barcode: '111' }); // another workspace may reuse both
    await variant('w1', p2.id, 'SKU-3'); // NULL barcodes never collide
    await variant('w1', p2.id, 'SKU-4');
    await expect(variant('w1', p1.id, 'SKU-5', { isDefault: true })).rejects.toThrow();

    await db.prisma.category.create({ data: { workspaceId: 'w1', name: 'Sofas' } });
    await expect(
      db.prisma.category.create({ data: { workspaceId: 'w1', name: 'Sofas' } }),
    ).rejects.toThrow();
    await db.prisma.category.create({ data: { workspaceId: 'w2', name: 'Sofas' } });
  });

  it('catalog: JSONB and trigram indexes exist', async () => {
    const rows = await db.prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
        AND indexname IN ('products_custom_fields_gin', 'products_name_trgm', 'products_code_trgm',
                          'product_variants_sku_trgm', 'product_variants_barcode_trgm')`;
    expect(rows).toHaveLength(5);
  });

  it('crm: one walk-in customer per workspace, phone and name indexes exist', async () => {
    const walkIn = (workspaceId: string) =>
      db.prisma.customer.create({
        data: { workspaceId, fullName: 'Walk-in customer', isWalkIn: true },
      });
    await walkIn('w1');
    await expect(walkIn('w1')).rejects.toThrow();
    await walkIn('w2'); // another workspace has its own
    await db.prisma.customer.create({
      data: { workspaceId: 'w1', fullName: 'Ada', phonesNormalized: ['+923001234567'] },
    });
    await db.prisma.customer.create({
      data: { workspaceId: 'w1', fullName: 'Bob', phonesNormalized: ['+923009999999'] },
    });
    const hits = await db.prisma.$queryRaw<Array<{ full_name: string }>>`
      SELECT full_name FROM customers WHERE workspace_id = 'w1' AND phones_normalized @> ARRAY['+923001234567']`;
    expect(hits.map((h) => h.full_name)).toEqual(['Ada']);
    const indexes = await db.prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN
        ('customers_phones_normalized_gin', 'customers_custom_fields_gin', 'customers_full_name_trgm',
         'leads_custom_fields_gin', 'leads_full_name_trgm', 'leads_interest_trgm')`;
    expect(indexes).toHaveLength(6);
    // email is case-insensitive
    await db.prisma.customer.create({
      data: { workspaceId: 'w1', fullName: 'E', email: 'Case@Test.example' },
    });
    expect(
      await db.prisma.customer.count({ where: { workspaceId: 'w1', email: 'case@test.example' } }),
    ).toBe(1);
  });

  it('sales: numbers are unique per workspace, one latest quotation, and amounts stay sane', async () => {
    const customer = await db.prisma.customer.create({
      data: { workspaceId: 'w1', fullName: 'C' },
    });
    const location = await db.prisma.inventoryLocation.create({
      data: { workspaceId: 'w1', name: 'Showroom' },
    });
    const order = (workspaceId: string, orderNumber: string, over: object = {}) =>
      db.prisma.order.create({
        data: {
          workspaceId,
          orderNumber,
          customerId: customer.id,
          locationId: location.id,
          subtotal: '1',
          totalAmount: '1',
          balanceDue: '1',
          ...over,
        },
      });
    await order('w1', 'ORD-1');
    await expect(order('w1', 'ORD-1')).rejects.toThrow();
    await expect(order('w1', 'ORD-2', { totalAmount: '-5' })).rejects.toThrow();

    const quotation = (number: string, over: object = {}) =>
      db.prisma.quotation.create({
        data: {
          workspaceId: 'w1',
          quotationNumber: number,
          subtotal: '1',
          totalAmount: '1',
          ...over,
        },
      });
    await quotation('Q-1');
    await expect(quotation('Q-1', { versionNumber: 2 })).rejects.toThrow(); // two latest versions of one quotation
    await quotation('Q-1', { versionNumber: 2, isLatest: false });
    const saved = await db.prisma.order.findFirstOrThrow({ where: { orderNumber: 'ORD-1' } });
    await expect(
      db.prisma.orderItem.create({
        data: {
          workspaceId: 'w1',
          orderId: saved.id,
          lineNo: 1,
          name: 'x',
          quantity: '0',
          listPrice: '1',
          unitPrice: '1',
          lineTotal: '0',
        },
      }),
    ).rejects.toThrow();
    const indexes = await db.prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN
        ('orders_order_number_trgm', 'quotations_quotation_number_trgm', 'orders_custom_fields_gin', 'quotations_custom_fields_gin')`;
    expect(indexes).toHaveLength(4);
  });

  it('rollback.sql files undo their migrations in reverse order, and the migrations re-apply', async () => {
    // The audit trigger forbids deleting audit rows, so none exist here; other tables are dropped whole.
    await runScript(db.prisma, migrationFile('0011_purchasing', 'rollback.sql'));
    expect(await tables()).toHaveLength(63);
    await runScript(db.prisma, migrationFile('0010_pos', 'rollback.sql'));
    expect(await tables()).toHaveLength(61);
    await runScript(db.prisma, migrationFile('0009_inventory', 'rollback.sql'));
    expect(await tables()).toHaveLength(55);
    await runScript(db.prisma, migrationFile('0008_finance', 'rollback.sql'));
    expect(await tables()).toHaveLength(48);
    await runScript(db.prisma, migrationFile('0007_invoice_immutable', 'rollback.sql'));
    await runScript(db.prisma, migrationFile('0006_sales', 'rollback.sql'));
    expect(await tables()).toHaveLength(39);
    await runScript(db.prisma, migrationFile('0005_search', 'rollback.sql'));
    await runScript(db.prisma, migrationFile('0004_crm', 'rollback.sql'));
    expect(await tables()).toHaveLength(35);
    await runScript(db.prisma, migrationFile('0003_catalog', 'rollback.sql'));
    expect(await tables()).toHaveLength(27);
    await runScript(db.prisma, migrationFile('0002_core', 'rollback.sql'));
    expect(await tables()).toEqual([]);
    const functions = await db.prisma.$queryRaw<Array<{ proname: string }>>`
      SELECT proname FROM pg_proc WHERE proname = 'audit_events_reject_change'`;
    expect(functions).toEqual([]);

    await runScript(db.prisma, migrationFile('0001_extensions', 'rollback.sql'));
    expect(await extensions()).toEqual([]);

    await runScript(db.prisma, migrationFile('0001_extensions', 'migration.sql'));
    await runScript(db.prisma, migrationFile('0002_core', 'migration.sql'));
    await runScript(db.prisma, migrationFile('0003_catalog', 'migration.sql'));
    await runScript(db.prisma, migrationFile('0004_crm', 'migration.sql'));
    await runScript(db.prisma, migrationFile('0005_search', 'migration.sql'));
    await runScript(db.prisma, migrationFile('0006_sales', 'migration.sql'));
    await runScript(db.prisma, migrationFile('0007_invoice_immutable', 'migration.sql'));
    await runScript(db.prisma, migrationFile('0008_finance', 'migration.sql'));
    await runScript(db.prisma, migrationFile('0009_inventory', 'migration.sql'));
    await runScript(db.prisma, migrationFile('0010_pos', 'migration.sql'));
    await runScript(db.prisma, migrationFile('0011_purchasing', 'migration.sql'));
    expect(await tables()).toHaveLength(69);
    expect(await extensions()).toEqual(['citext', 'pg_trgm']);
  });
});
