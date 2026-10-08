import fc from 'fast-check';
import { ensureWorkspace } from './helpers/tenant-factories';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';

/**
 * Property 4 — audit events are append-only (the stock ledger joins this test in task 45).
 * Any UPDATE or DELETE on audit_events fails at the database, whatever the row or column,
 * and the row is left exactly as it was.
 */
describe('Property 4 — audit_events is append-only', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await ensureWorkspace(db.prisma, 'ws_audit');
  }, 60_000);
  afterAll(() => db.drop());

  const text = fc.string({ minLength: 1, maxLength: 40 });

  it('rejects every UPDATE and DELETE and leaves the row unchanged (100+ cases)', async () => {
    await fc.assert(
      fc.asyncProperty(
        text,
        text,
        text,
        fc.constantFrom('action', 'entity_type', 'entity_id', 'actor_role', 'request_id'),
        async (action, entityType, replacement, column) => {
          const row = await db.prisma.auditEvent.create({
            data: {
              workspaceId: 'ws_audit',
              action,
              entityType,
              entityId: 'e',
              newState: { a: 1 },
            },
          });

          await expect(
            db.prisma.$executeRawUnsafe(
              `UPDATE audit_events SET ${column} = $1 WHERE id = $2`,
              replacement,
              row.id,
            ),
          ).rejects.toThrow(/append-only/);
          await expect(
            db.prisma.$executeRawUnsafe('DELETE FROM audit_events WHERE id = $1', row.id),
          ).rejects.toThrow(/append-only/);
          await expect(
            db.prisma.auditEvent.updateMany({ where: { id: row.id }, data: { action: 'x' } }),
          ).rejects.toThrow(/append-only/);
          await expect(db.prisma.auditEvent.deleteMany({ where: { id: row.id } })).rejects.toThrow(
            /append-only/,
          );

          const after = await db.prisma.auditEvent.findUniqueOrThrow({ where: { id: row.id } });
          expect(after).toEqual(row);
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);

  it('still allows inserts', async () => {
    const created = await db.prisma.auditEvent.create({
      data: { workspaceId: 'ws_audit', action: 'a', entityType: 'T', entityId: '1' },
    });
    expect(created.id).toBeTruthy();
  });
});
