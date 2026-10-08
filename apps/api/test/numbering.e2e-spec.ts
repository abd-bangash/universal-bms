import fc from 'fast-check';
import { PrismaService } from '../src/common/prisma/prisma.service';
import {
  formatDocumentNumber,
  NumberingService,
  yearIn,
} from '../src/modules/numbering/numbering.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { createTestApp, type TestApp } from './helpers/auth-app';
import { runWithWorkspace } from './helpers/context';

describe('Document numbering (real PostgreSQL)', () => {
  let t: TestApp;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp();
  }, 90_000);
  afterAll(() => t.close());

  async function workspace() {
    const created = await t.app.get(TenantsService).createWorkspace({
      name: `Numbering ${++n}`,
      industryProfile: 'furniture',
      owner: {
        email: `owner${n}@numbering.test`,
        firstName: 'O',
        lastName: 'O',
        password: 'owner-password-1',
      },
      timezone: 'Asia/Karachi',
    });
    return created.workspaceId;
  }
  const run = <T2>(workspaceId: string, work: () => Promise<T2>) =>
    runWithWorkspace(t.app, workspaceId, work);
  const numbering = () => t.app.get(NumberingService);
  const prisma = () => t.app.get(PrismaService);
  const issue = (
    workspaceId: string,
    docType: 'QUOTATION' | 'ORDER' | 'INVOICE' | 'RECEIPT' = 'ORDER',
    at?: Date,
  ) =>
    run(workspaceId, () => prisma().scoped.$transaction((tx) => numbering().next(tx, docType, at)));

  describe('format (23.5)', () => {
    it('joins prefix, year and zero-padded counter', () => {
      expect(formatDocumentNumber({ prefix: 'QT-', includeYear: true, padding: 4 }, 2026, 4)).toBe(
        'QT-2026-0004',
      );
      expect(
        formatDocumentNumber({ prefix: 'RCP-', includeYear: false, padding: 5 }, 2026, 12),
      ).toBe('RCP-00012');
      expect(
        formatDocumentNumber({ prefix: '', includeYear: false, padding: 1 }, 2026, 12345),
      ).toBe('12345');
      expect(
        formatDocumentNumber({ prefix: 'X', includeYear: false, padding: 3 }, 2026, 1234),
      ).toBe('X1234'); // never truncated
    });

    it('takes the year from the workspace timezone', () => {
      const newYearsEveUtc = new Date('2026-12-31T20:00:00Z'); // already 2027 in Karachi (UTC+5)
      expect(yearIn('UTC', newYearsEveUtc)).toBe(2026);
      expect(yearIn('Asia/Karachi', newYearsEveUtc)).toBe(2027);
    });
  });

  describe('issuing numbers', () => {
    it("counts up from one with the workspace's own format, separately for each type", async () => {
      const ws = await workspace();
      const year = yearIn('Asia/Karachi', new Date());
      expect(await issue(ws, 'ORDER')).toBe(`ORD-${year}-0001`);
      expect(await issue(ws, 'ORDER')).toBe(`ORD-${year}-0002`);
      expect(await issue(ws, 'QUOTATION')).toBe(`QT-${year}-0001`);
      expect(await issue(ws, 'RECEIPT')).toBe(`RCP-${year}-00001`);
      expect(await issue(ws, 'ORDER')).toBe(`ORD-${year}-0003`);
    });

    it('keeps workspaces apart', async () => {
      const a = await workspace();
      const b = await workspace();
      const year = yearIn('Asia/Karachi', new Date());
      await issue(a);
      await issue(a);
      expect(await issue(b)).toBe(`ORD-${year}-0001`);
      expect(await issue(a)).toBe(`ORD-${year}-0003`);
    });

    it('follows a changed format, and can run without a year', async () => {
      const ws = await workspace();
      await run(ws, () =>
        t.app
          .get(SettingsService)
          .update({ numbering: { ORDER: { prefix: 'SO/', includeYear: false, padding: 6 } } }),
      );
      expect(await issue(ws)).toBe('SO/000001');
      expect(await issue(ws)).toBe('SO/000002');
      // switching the year back on starts that year's own counter
      await run(ws, () =>
        t.app
          .get(SettingsService)
          .update({ numbering: { ORDER: { prefix: 'ORD-', includeYear: true, padding: 4 } } }),
      );
      expect(await issue(ws, 'ORDER', new Date('2031-06-01T00:00:00Z'))).toBe('ORD-2031-0001');
    });

    it('starts a new count in a new year, and keeps counting the old year if asked for it', async () => {
      const ws = await workspace();
      expect(await issue(ws, 'INVOICE', new Date('2030-12-31T10:00:00Z'))).toBe('INV-2030-0001');
      expect(await issue(ws, 'INVOICE', new Date('2030-12-31T11:00:00Z'))).toBe('INV-2030-0002');
      expect(await issue(ws, 'INVOICE', new Date('2031-01-01T10:00:00Z'))).toBe('INV-2031-0001');
      expect(await issue(ws, 'INVOICE', new Date('2030-12-31T12:00:00Z'))).toBe('INV-2030-0003');
    });

    it("gives a number back when the document's transaction rolls back", async () => {
      const ws = await workspace();
      const year = yearIn('Asia/Karachi', new Date());
      expect(await issue(ws)).toBe(`ORD-${year}-0001`);
      await expect(
        run(ws, () =>
          prisma().scoped.$transaction(async (tx) => {
            expect(await numbering().next(tx, 'ORDER')).toBe(`ORD-${year}-0002`);
            throw new Error('the order failed to save');
          }),
        ),
      ).rejects.toThrow('failed to save');
      expect(await issue(ws)).toBe(`ORD-${year}-0002`); // no gap
    });
  });

  // Property 15 — Document numbers. Validates 23.5, 54.5.
  describe('Property 15 — unique and gap-free under concurrency', () => {
    it('for any number of concurrent creations, some of which fail, the numbers issued to the ones that succeed are exactly 1..k', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.boolean(), { minLength: 1, maxLength: 16 }),
          async (failures) => {
            const ws = await workspace();
            const results = await run(ws, () =>
              Promise.all(
                failures.map((fails) =>
                  prisma()
                    .scoped.$transaction(async (tx) => {
                      const number = await numbering().next(tx, 'ORDER');
                      if (fails) throw new Error('rolled back');
                      return number;
                    })
                    .then(
                      (number) => ({ ok: true as const, number }),
                      () => ({ ok: false as const }),
                    ),
                ),
              ),
            );
            const issued = results.flatMap((r) => (r.ok ? [r.number] : []));
            const counters = issued.map((x) => Number(x.split('-').at(-1))).sort((a, b) => a - b);
            expect(new Set(issued).size).toBe(issued.length); // unique
            expect(counters).toEqual(Array.from({ length: issued.length }, (_, i) => i + 1)); // 1..k, no gaps
            const row = await t.db.prisma.documentSequence.findFirstOrThrow({
              where: { workspaceId: ws, docType: 'ORDER' },
            });
            expect(row.nextValue).toBe(issued.length + 1);
          },
        ),
        { numRuns: 25 },
      );
    }, 180_000);

    it('holds for many concurrent documents of several types at once', async () => {
      const ws = await workspace();
      const types = ['ORDER', 'QUOTATION', 'INVOICE'] as const;
      const jobs = Array.from({ length: 24 }, (_, i) => types[i % 3] as (typeof types)[number]);
      const issued = await run(ws, () =>
        Promise.all(
          jobs.map((type) =>
            prisma()
              .scoped.$transaction((tx) => numbering().next(tx, type))
              .then((number) => ({ type, number })),
          ),
        ),
      );
      for (const type of types) {
        const counters = issued
          .filter((i) => i.type === type)
          .map((i) => Number(i.number.split('-').at(-1)))
          .sort((a, b) => a - b);
        expect(counters).toEqual(Array.from({ length: 8 }, (_, i) => i + 1));
      }
    });
  });
});
