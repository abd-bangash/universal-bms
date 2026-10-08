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

  it('0001 creates the extensions and 0002 creates the 27 core tables', async () => {
    expect(await extensions()).toEqual(['citext', 'pg_trgm']);
    const names = await tables();
    expect(names).toHaveLength(27);
    expect(names).toEqual(expect.arrayContaining(['workspaces', 'audit_events', 'users', 'tasks']));
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

  it('rollback.sql files undo their migrations in reverse order, and the migrations re-apply', async () => {
    // The audit trigger forbids deleting audit rows, so none exist here; other tables are dropped whole.
    await runScript(db.prisma, migrationFile('0002_core', 'rollback.sql'));
    expect(await tables()).toEqual([]);
    const functions = await db.prisma.$queryRaw<Array<{ proname: string }>>`
      SELECT proname FROM pg_proc WHERE proname = 'audit_events_reject_change'`;
    expect(functions).toEqual([]);

    await runScript(db.prisma, migrationFile('0001_extensions', 'rollback.sql'));
    expect(await extensions()).toEqual([]);

    await runScript(db.prisma, migrationFile('0001_extensions', 'migration.sql'));
    await runScript(db.prisma, migrationFile('0002_core', 'migration.sql'));
    expect(await tables()).toHaveLength(27);
    expect(await extensions()).toEqual(['citext', 'pg_trgm']);
  });
});
