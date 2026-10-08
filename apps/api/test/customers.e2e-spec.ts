import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { CustomersService } from '../src/modules/crm/customers.service';
import { normalizePhone } from '../src/modules/crm/phone.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { runWithWorkspace } from './helpers/context';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Customers API (real PostgreSQL)', () => {
  let t: TestApp;
  let app: INestApplication;
  let http: ReturnType<typeof api>;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp();
    app = t.app;
    http = api(app);
  }, 90_000);
  afterAll(() => t.close());

  async function business(country: string | null = 'PK') {
    const email = `owner${++n}@crm.test`;
    const created = await app.get(TenantsService).createWorkspace({
      name: `CRM ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'Olivia', lastName: 'Owner', password: 'owner-password-1' },
      country: country ?? undefined,
    });
    const login = await http
      .post('/auth/login', { email, password: 'owner-password-1' })
      .expect(200);
    const token = login.body.data.accessToken as string;
    const roles = (await http.get('/roles', token).expect(200)).body.data as Json[];
    return { ...created, token, roles, ownerId: login.body.data.user?.id as string | undefined };
  }
  type Biz = Awaited<ReturnType<typeof business>>;

  async function member(b: Biz, roleName: string) {
    const email = `${roleName.toLowerCase().replace(/\W/g, '')}${++n}@crm.test`;
    const role = b.roles.find((r) => r.name === roleName) as Json;
    const invite = await http
      .post('/users/invite', { email, roleIds: [role.id] }, b.token)
      .expect(201);
    await http
      .post('/auth/invite/accept', {
        token: invite.body.data.token,
        password: 'member-password-1',
        firstName: 'M',
        lastName: 'M',
      })
      .expect(200);
    const login = await http
      .post('/auth/login', { email, password: 'member-password-1' })
      .expect(200);
    return login.body.data.accessToken as string;
  }

  const create = (b: Biz, body: object) => http.post('/customers', body, b.token);

  describe('phone normalisation (Requirement 8.2)', () => {
    it('reads local and international formats as the same E.164 number', () => {
      for (const written of [
        '0300-1234567',
        '+92 300 1234567',
        '923001234567',
        '(0300) 123 4567',
        '0092 300 1234567',
      ]) {
        expect(normalizePhone(written, 'PK')).toBe('+923001234567');
      }
      expect(normalizePhone('+1 415 555 2671')).toBe('+14155552671');
      expect(normalizePhone('0300-1234567')).toBeNull(); // no country, no international prefix
      expect(normalizePhone('12345', 'PK')).toBeNull();
      expect(normalizePhone('call me', 'PK')).toBeNull();
    });
  });

  describe('create, read, update (8.1, 54.2)', () => {
    it('stores contact details, tags, addresses and custom fields; money-free, versioned', async () => {
      const b = await business();
      const res = await create(b, {
        fullName: '  Ayesha Khan ',
        phones: ['0300-1234567', '+92 321 7654321'],
        email: 'Ayesha@Example.com',
        billingAddress: { line1: '12 Garden Road', city: 'Karachi', country: 'Pakistan' },
        shippingAddress: { line1: '5 Beach Ave', city: 'Karachi' },
        preferredChannel: 'WHATSAPP',
        tags: ['vip', 'vip', ' repeat '],
        source: 'Instagram',
        notes: 'Prefers evening calls',
      }).expect(201);
      expect(res.body.data).toMatchObject({
        fullName: 'Ayesha Khan',
        phones: ['0300-1234567', '+92 321 7654321'],
        email: 'ayesha@example.com',
        tags: ['vip', 'repeat'],
        status: 'ACTIVE',
        version: 1,
        preferredChannel: 'WHATSAPP',
      });
      expect(res.body.data.billingAddress).toMatchObject({ city: 'Karachi' });
      const row = await t.db.prisma.customer.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(row.phonesNormalized).toEqual(['+923001234567', '+923217654321']);

      const read = await http.get(`/customers/${res.body.data.id}`, b.token).expect(200);
      expect(read.body.data.id).toBe(res.body.data.id);

      const patched = await http
        .patch(
          `/customers/${res.body.data.id}`,
          { version: 1, notes: 'Changed', tags: ['vip'] },
          b.token,
        )
        .expect(200);
      expect(patched.body.data).toMatchObject({ notes: 'Changed', tags: ['vip'], version: 2 });
      const stale = await http
        .patch(`/customers/${res.body.data.id}`, { version: 1, notes: 'Stale' }, b.token)
        .expect(409);
      expect(stale.body.code).toBe('STALE_VERSION');
      await http
        .patch(`/customers/${res.body.data.id}`, { notes: 'No version' }, b.token)
        .expect(400);
    });

    it('rejects bad input with field-level errors', async () => {
      const b = await business();
      await create(b, { phones: ['0300'] }).expect(400);
      const badPhone = await create(b, { fullName: 'X', phones: ['nonsense'] }).expect(400);
      expect(badPhone.body.details.phones).toBeDefined();
      await create(b, { fullName: 'X', email: 'not-an-email' }).expect(400);
      await create(b, { fullName: 'X', assignedToId: 'nobody' }).expect(400);
      await create(b, { fullName: 'X', priceListId: 'nope' }).expect(400);
      await create(b, { fullName: 'X', preferredChannel: 'PIGEON' }).expect(400);
      await create(b, { fullName: 'X', unknownField: 1 }).expect(400);
    });

    it('asks for the country code when the business country is not set', async () => {
      const b = await business(null);
      const res = await create(b, { fullName: 'No Country', phones: ['0300-1234567'] }).expect(400);
      expect(res.body.details.phones[0]).toMatch(/country code/);
      await create(b, { fullName: 'With Code', phones: ['+92 300 1234567'] }).expect(201);
    });

    it('validates custom fields against the CUSTOMER definitions (26.3)', async () => {
      const b = await business();
      await http
        .post(
          '/fields',
          {
            entityType: 'CUSTOMER',
            key: 'room_count',
            label: 'Rooms',
            type: 'NUMBER',
            required: true,
          },
          b.token,
        )
        .expect(201);
      const missing = await create(b, { fullName: 'A' }).expect(400);
      expect(missing.body.details['customFields.room_count']).toBeDefined();
      await create(b, { fullName: 'A', customFields: { room_count: 'many' } }).expect(400);
      const ok = await create(b, { fullName: 'A', customFields: { room_count: '4' } }).expect(201);
      expect(ok.body.data.customFields).toEqual({ room_count: '4' });
    });

    it('assigns to an active staff member of the workspace only', async () => {
      const b = await business();
      const other = await business();
      const salesToken = await member(b, 'Salesperson');
      const me = (await http.get('/auth/me', salesToken).expect(200)).body.data;
      const otherMe = (await http.get('/auth/me', other.token).expect(200)).body.data;
      const assigned = await create(b, { fullName: 'Assigned', assignedToId: me.user.id }).expect(
        201,
      );
      expect(assigned.body.data.assignedToId).toBe(me.user.id);
      await create(b, { fullName: 'Foreign', assignedToId: otherMe.user.id }).expect(400);
    });
  });

  describe('duplicate detection (8.2) — Requirement 8.2 integration', () => {
    it('detects the same phone written in different formats and returns the candidates with 409', async () => {
      const b = await business();
      const first = (
        await create(b, { fullName: 'Original Person', phones: ['0300-1234567'] }).expect(201)
      ).body.data as Json;

      for (const written of ['+92 300 1234567', '923001234567', '(0300) 123-4567']) {
        const dup = await create(b, { fullName: 'Someone Else', phones: [written] }).expect(409);
        expect(dup.body.code).toBe('POSSIBLE_DUPLICATE');
        expect(dup.body.data.hasDuplicates).toBe(true);
        expect(dup.body.data.candidates).toEqual([
          expect.objectContaining({
            id: first.id,
            fullName: 'Original Person',
            reasons: ['PHONE'],
          }),
        ]);
      }
      expect(
        await t.db.prisma.customer.count({
          where: { workspaceId: b.workspaceId, isWalkIn: false },
        }),
      ).toBe(1);

      // the user has seen the match and confirms: it is saved
      const confirmed = await create(b, {
        fullName: 'Someone Else',
        phones: ['+92 300 1234567'],
        confirmDuplicate: true,
      }).expect(201);
      expect(confirmed.body.data.id).not.toBe(first.id);
    });

    it('matches email regardless of case, and similar names only when the rule is on', async () => {
      const b = await business();
      await create(b, { fullName: 'Muhammad Bilal Ahmed', email: 'bilal@example.com' }).expect(201);
      const byEmail = await create(b, {
        fullName: 'Totally Different',
        email: 'BILAL@Example.com',
      }).expect(409);
      expect(byEmail.body.data.candidates[0].reasons).toEqual(['EMAIL']);

      // names are not compared by default (matchOn = PHONE, EMAIL)
      await create(b, { fullName: 'Muhammad Bilal Ahmad' }).expect(201);
      await http
        .patch(
          '/settings',
          { duplicates: { matchOn: ['PHONE', 'EMAIL', 'NAME_SIMILAR'] } },
          b.token,
        )
        .expect(200);
      const similar = await create(b, { fullName: 'Mohammad Bilal Ahmed' }).expect(409);
      expect(similar.body.data.candidates.map((c: Json) => c.reasons).flat()).toContain(
        'NAME_SIMILAR',
      );
      await create(b, { fullName: 'Zainab Siddiqui' }).expect(201);
    });

    it('checks again on update, excluding the customer itself, and only when identity changes', async () => {
      const b = await business();
      const a = (await create(b, { fullName: 'A Person', phones: ['0300-1111111'] }).expect(201))
        .body.data as Json;
      const c = (await create(b, { fullName: 'C Person', phones: ['0300-2222222'] }).expect(201))
        .body.data as Json;
      // keeping its own number is fine
      await http
        .patch(
          `/customers/${a.id}`,
          { version: 1, phones: ['+92 300 1111111'], notes: 'x' },
          b.token,
        )
        .expect(200);
      // taking another customer's number is flagged
      const clash = await http
        .patch(`/customers/${c.id}`, { version: 1, phones: ['0300 1111111'] }, b.token)
        .expect(409);
      expect(clash.body.data.candidates[0].id).toBe(a.id);
      await http
        .patch(
          `/customers/${c.id}`,
          { version: 1, phones: ['0300 1111111'], confirmDuplicate: true },
          b.token,
        )
        .expect(200);
    });

    it('does not treat archived customers or the walk-in customer as duplicates', async () => {
      const b = await business();
      const a = (
        await create(b, { fullName: 'Archived One', phones: ['0300-5555555'] }).expect(201)
      ).body.data as Json;
      await http.post(`/customers/${a.id}/archive`, {}, b.token).expect(200);
      await create(b, { fullName: 'New One', phones: ['0300-5555555'] }).expect(201);
      await create(b, { fullName: 'Walk-in customer' }).expect(201);
    });
  });

  describe('the walk-in customer (12.10) — hidden and untouchable', () => {
    it('exists once per workspace but is never listed, read, edited, archived or timelined', async () => {
      const b = await business();
      const walkIn = await t.db.prisma.customer.findFirstOrThrow({
        where: { workspaceId: b.workspaceId, isWalkIn: true },
      });
      const list = await http.get('/customers?limit=100', b.token).expect(200);
      expect(list.body.data).toEqual([]);
      expect((await http.get('/customers?q=walk', b.token).expect(200)).body.data).toEqual([]);
      await http.get(`/customers/${walkIn.id}`, b.token).expect(404);
      await http
        .patch(`/customers/${walkIn.id}`, { version: 1, fullName: 'Renamed' }, b.token)
        .expect(404);
      await http.post(`/customers/${walkIn.id}/archive`, {}, b.token).expect(404);
      await http.get(`/customers/${walkIn.id}/timeline`, b.token).expect(404);
      await http.get(`/customers/${walkIn.id}/finance`, b.token).expect(404);
      const after = await t.db.prisma.customer.findUniqueOrThrow({ where: { id: walkIn.id } });
      expect(after).toMatchObject({ fullName: 'Walk-in customer', status: 'ACTIVE', version: 1 });

      // POS gets it through the service
      const found = await runWithWorkspace(app, b.workspaceId, () =>
        app.get(CustomersService).walkIn(),
      );
      expect(found.id).toBe(walkIn.id);
    });
  });

  describe('lists and filters (8.5, 26.7)', () => {
    it('filters by name, phone, email, tag, staff, source and custom field, and pages by cursor', async () => {
      const b = await business();
      const sales = await member(b, 'Salesperson');
      const salesId = (await http.get('/auth/me', sales)).body.data.user.id as string;
      await http
        .post(
          '/fields',
          {
            entityType: 'CUSTOMER',
            key: 'tier',
            label: 'Tier',
            type: 'DROPDOWN',
            options: [
              { key: 'gold', label: 'Gold' },
              { key: 'basic', label: 'Basic' },
            ],
          },
          b.token,
        )
        .expect(201);
      await create(b, {
        fullName: 'Alice Ahmed',
        phones: ['0300-1000001'],
        email: 'alice@x.test',
        tags: ['vip'],
        source: 'Walk-in',
        assignedToId: salesId,
        customFields: { tier: 'gold' },
      }).expect(201);
      await create(b, {
        fullName: 'Bob Baig',
        phones: ['0300-1000002'],
        email: 'bob@y.test',
        tags: ['repeat'],
        source: 'Instagram',
        customFields: { tier: 'basic' },
      }).expect(201);
      await create(b, {
        fullName: 'Carol Chaudhry',
        phones: ['0300-1000003'],
        tags: ['vip', 'repeat'],
        source: 'Instagram',
      }).expect(201);

      const names = async (qs: string) =>
        ((await http.get(`/customers${qs}`, b.token).expect(200)).body.data as Json[]).map(
          (c) => c.fullName,
        );
      expect(await names('')).toEqual(['Alice Ahmed', 'Bob Baig', 'Carol Chaudhry']);
      expect(await names('?q=bob')).toEqual(['Bob Baig']);
      expect(await names('?q=y.test')).toEqual(['Bob Baig']);
      expect(await names('?q=1000003')).toEqual(['Carol Chaudhry']);
      expect(await names('?phone=%2B92%20300%201000002')).toEqual(['Bob Baig']);
      expect(await names('?phone=0300-1000001')).toEqual(['Alice Ahmed']);
      expect(await names('?email=ALICE@x.test')).toEqual(['Alice Ahmed']);
      expect(await names('?tag=vip')).toEqual(['Alice Ahmed', 'Carol Chaudhry']);
      expect(await names(`?assignedToId=${salesId}`)).toEqual(['Alice Ahmed']);
      expect(await names('?source=Instagram')).toEqual(['Bob Baig', 'Carol Chaudhry']);
      expect(await names('?cf.tier=gold')).toEqual(['Alice Ahmed']);
      expect(await names('?tag=vip&source=Instagram')).toEqual(['Carol Chaudhry']);
      expect(await names('?sort=fullName:desc')).toEqual([
        'Carol Chaudhry',
        'Bob Baig',
        'Alice Ahmed',
      ]);
      await http.get('/customers?cf.nope=1', b.token).expect(400);
      await http.get('/customers?sort=email:asc', b.token).expect(400);
      await http.get('/customers?phone=garbage', b.token).expect(400);

      const p1 = await http.get('/customers?limit=2', b.token).expect(200);
      expect(p1.body.data).toHaveLength(2);
      const p2 = await http
        .get(`/customers?limit=2&cursor=${p1.body.meta.nextCursor}`, b.token)
        .expect(200);
      expect((p2.body.data as Json[]).map((c) => c.fullName)).toEqual(['Carol Chaudhry']);
      expect(p2.body.meta.nextCursor).toBeUndefined();
    });

    it('archives instead of deleting, and hides archived customers from the default list', async () => {
      const b = await business();
      const c = (await create(b, { fullName: 'Soon Archived' }).expect(201)).body.data as Json;
      const archived = await http.post(`/customers/${c.id}/archive`, {}, b.token).expect(200);
      expect(archived.body.data.status).toBe('ARCHIVED');
      expect((await http.get('/customers', b.token)).body.data).toEqual([]);
      expect(
        ((await http.get('/customers?status=ARCHIVED', b.token)).body.data as Json[]).map(
          (x) => x.fullName,
        ),
      ).toEqual(['Soon Archived']);
      await http
        .patch(`/customers/${c.id}`, { version: archived.body.data.version, notes: 'x' }, b.token)
        .expect(422);
      const restored = await http.post(`/customers/${c.id}/restore`, {}, b.token).expect(200);
      expect(restored.body.data.status).toBe('ACTIVE');
    });
  });

  describe('timeline and finance (8.4, 8.6)', () => {
    it('records "customer created" from the Domain_Event and lists newest first', async () => {
      const b = await business();
      const c = (await create(b, { fullName: 'Timeline Tim' }).expect(201)).body.data as Json;
      const prisma = app.get(PrismaService).unscoped;
      await prisma.timelineEntry.create({
        data: {
          workspaceId: b.workspaceId,
          customerId: c.id,
          type: 'NOTE',
          summary: 'Later note',
          occurredAt: new Date(Date.now() + 60_000),
        },
      });
      const res = await http.get(`/customers/${c.id}/timeline`, b.token).expect(200);
      expect((res.body.data as Json[]).map((e) => e.summary)).toEqual([
        'Later note',
        'Customer record created',
      ]);
      expect(res.body.data[1]).toMatchObject({ type: 'SYSTEM', refType: 'Customer', refId: c.id });

      const page = await http.get(`/customers/${c.id}/timeline?limit=1`, b.token).expect(200);
      expect(page.body.data).toHaveLength(1);
      const next = await http
        .get(`/customers/${c.id}/timeline?limit=1&cursor=${page.body.meta.nextCursor}`, b.token)
        .expect(200);
      expect((next.body.data as Json[]).map((e) => e.summary)).toEqual(['Customer record created']);
    });

    it('returns zero finance figures until orders and payments exist, and needs payment:view', async () => {
      const b = await business();
      const c = (await create(b, { fullName: 'Finance Fay' }).expect(201)).body.data as Json;
      const finance = await http.get(`/customers/${c.id}/finance`, b.token).expect(200);
      expect(finance.body.data).toEqual({
        lifetimeValue: '0',
        totalPaid: '0',
        outstandingBalance: '0',
        creditBalance: '0',
      });
      const viewer = await member(b, 'Production Staff'); // no payment:view
      await http.get(`/customers/${c.id}/finance`, viewer).expect(403);
    });
  });

  describe('permissions and tenant isolation', () => {
    it('enforces customer permissions', async () => {
      const b = await business();
      const viewer = await member(b, 'Viewer');
      const c = (await create(b, { fullName: 'Perm Pat' }).expect(201)).body.data as Json;
      await http.get('/customers', viewer).expect(200);
      await http.post('/customers', { fullName: 'x' }, viewer).expect(403);
      await http.patch(`/customers/${c.id}`, { version: 1, notes: 'x' }, viewer).expect(403);
      await http.post(`/customers/${c.id}/archive`, {}, viewer).expect(403);
      const sales = await member(b, 'Salesperson'); // may create and edit, not archive
      await http.post('/customers', { fullName: 'By sales' }, sales).expect(201);
      await http.post(`/customers/${c.id}/archive`, {}, sales).expect(403);
    });

    it('another workspace cannot see, change or collide with a customer', async () => {
      const a = await business();
      const b = await business();
      const c = (
        await create(a, {
          fullName: 'Private Pia',
          phones: ['0300-9999999'],
          email: 'pia@x.test',
        }).expect(201)
      ).body.data as Json;
      await http.get(`/customers/${c.id}`, b.token).expect(404);
      await http.patch(`/customers/${c.id}`, { version: 1, notes: 'x' }, b.token).expect(404);
      await http.post(`/customers/${c.id}/archive`, {}, b.token).expect(404);
      await http.get(`/customers/${c.id}/timeline`, b.token).expect(404);
      expect((await http.get('/customers?q=pia', b.token)).body.data).toEqual([]);
      // the same phone in another workspace is not a duplicate
      await create(b, {
        fullName: 'Own Pia',
        phones: ['0300-9999999'],
        email: 'pia@x.test',
      }).expect(201);
    });
  });
});
