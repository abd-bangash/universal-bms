import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import sharp from 'sharp';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Leads API (real PostgreSQL)', () => {
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

  async function business() {
    const email = `owner${++n}@leads.test`;
    const created = await app.get(TenantsService).createWorkspace({
      name: `Leads ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'Olivia', lastName: 'Owner', password: 'owner-password-1' },
      country: 'PK',
    });
    const login = await http
      .post('/auth/login', { email, password: 'owner-password-1' })
      .expect(200);
    const token = login.body.data.accessToken as string;
    const roles = (await http.get('/roles', token).expect(200)).body.data as Json[];
    const me = (await http.get('/auth/me', token)).body.data;
    return { ...created, token, roles, userId: me.user.id as string };
  }
  type Biz = Awaited<ReturnType<typeof business>>;

  async function member(b: Biz, roleName: string) {
    const email = `${roleName.toLowerCase().replace(/\W/g, '')}${++n}@leads.test`;
    const role = b.roles.find((r) => r.name === roleName) as Json;
    const invite = await http
      .post('/users/invite', { email, roleIds: [role.id] }, b.token)
      .expect(201);
    await http
      .post('/auth/invite/accept', {
        token: invite.body.data.token,
        password: 'member-password-1',
        firstName: roleName,
        lastName: 'Person',
      })
      .expect(200);
    const login = await http
      .post('/auth/login', { email, password: 'member-password-1' })
      .expect(200);
    const token = login.body.data.accessToken as string;
    const me = (await http.get('/auth/me', token)).body.data;
    return { token, userId: me.user.id as string };
  }

  const createLead = (b: Biz | { token: string }, body: object = {}) =>
    http.post('/leads', { fullName: 'Sana Malik', phone: '0300-1234567', ...body }, b.token);
  const stageOf = async (b: Biz, id: string) =>
    (await http.get(`/leads/${id}`, b.token)).body.data.stage as string;
  const move = (b: Biz | { token: string }, id: string, stage: string, extra: object = {}) =>
    http.post(`/leads/${id}/stage`, { stage, ...extra }, b.token);

  describe('create and read (9.2)', () => {
    it('creates a lead with the furniture requirement fields and starts it in the New stage', async () => {
      const b = await business();
      const product = (
        await http
          .post('/catalog/products', { name: 'Corner Sofa', basePrice: '145000' }, b.token)
          .expect(201)
      ).body.data as Json;
      const res = await createLead(b, {
        email: 'Sana@Example.com',
        source: 'SOCIAL',
        channel: 'INSTAGRAM',
        campaign: 'Eid sale',
        interest: 'L-shaped sofa for a small lounge',
        productId: product.id,
        requirements: 'Grey fabric, washable covers',
        quantity: '1',
        estimatedValue: '150000.00',
        priority: 'HIGH',
        nextAction: 'Call to confirm measurements',
        nextActionDate: '2026-11-01T09:00:00.000Z',
        customFields: {
          size_type: 'custom',
          length: { value: '9', unit: 'ft' },
          width: { value: '6', unit: 'ft' },
          material: 'fabric',
          color: 'Grey',
        },
      }).expect(201);
      expect(res.body.data).toMatchObject({
        fullName: 'Sana Malik',
        stage: 'new',
        priority: 'HIGH',
        email: 'sana@example.com',
        estimatedValue: '150000',
        quantity: '1',
        existing: false,
        version: 1,
        productId: product.id,
      });
      expect(res.body.data.customFields).toMatchObject({
        size_type: 'custom',
        length: { value: '9', unit: 'ft' },
      });
      const row = await t.db.prisma.lead.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(row.phoneNormalized).toBe('+923001234567');
      expect(row.createdById).toBe(b.userId);

      const read = await http.get(`/leads/${res.body.data.id}`, b.token).expect(200);
      expect(read.body.data.allowedTransitions.map((a: Json) => a.to)).toEqual(
        expect.arrayContaining(['contacted', 'won', 'lost']),
      );
    });

    it('validates input and custom fields', async () => {
      const b = await business();
      await http.post('/leads', { phone: '0300-1' }, b.token).expect(400);
      await createLead(b, { phone: 'nonsense' }).expect(400);
      await createLead(b, { priority: 'URGENT' }).expect(400);
      await createLead(b, { source: 'CARRIER_PIGEON' }).expect(400);
      await createLead(b, { estimatedValue: 100 }).expect(400);
      await createLead(b, { productId: 'nope' }).expect(400);
      // length is only shown (and valid) for custom sizes, but a value of the wrong unit is refused
      const bad = await createLead(b, {
        customFields: { size_type: 'custom', length: { value: '9', unit: 'kg' } },
      }).expect(400);
      expect(bad.body.details['customFields.length']).toBeDefined();
    });
  });

  describe('stage changes (9.1, 9.3, 9.5)', () => {
    it('writes a history row and a timeline line for every stage change', async () => {
      const b = await business();
      const lead = (await createLead(b).expect(201)).body.data as Json;
      for (const stage of ['contacted', 'qualified', 'quoted', 'negotiation']) {
        const res = await move(b, lead.id, stage, { note: `to ${stage}` }).expect(200);
        expect(res.body.data).toMatchObject({ pendingApproval: false, to: stage });
      }
      const history = await t.db.prisma.statusHistory.findMany({
        where: { workspaceId: b.workspaceId, entityId: lead.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(history.map((h) => [h.fromKey, h.toKey])).toEqual([
        [null, 'new'],
        ['new', 'contacted'],
        ['contacted', 'qualified'],
        ['qualified', 'quoted'],
        ['quoted', 'negotiation'],
      ]);
      expect(history[2]).toMatchObject({ changedById: b.userId, note: 'to qualified' });

      const timeline = (await http.get(`/leads/${lead.id}/timeline`, b.token).expect(200)).body
        .data as Json[];
      const summaries = timeline.map((e) => e.summary);
      expect(summaries).toEqual(
        expect.arrayContaining([
          'Lead created',
          'Stage changed from New to Contacted: to contacted',
          'Stage changed from Quoted to Negotiation: to negotiation',
        ]),
      );
      expect(timeline.filter((e) => e.type === 'STATUS')).toHaveLength(4);
    });

    it('refuses a move that the workflow does not allow, with the allowed stages', async () => {
      const b = await business();
      const lead = (await createLead(b).expect(201)).body.data as Json;
      await move(b, lead.id, 'won').expect(200);
      const res = await move(b, lead.id, 'contacted').expect(422);
      expect(res.body.code).toBe('TRANSITION_NOT_ALLOWED');
      expect(await stageOf(b, lead.id)).toBe('won');
      await move(b, lead.id, 'nowhere').expect(422);
    });

    it('requires a lost reason to mark a lead Lost, and stores it with the closing time', async () => {
      const b = await business();
      const lead = (await createLead(b).expect(201)).body.data as Json;
      const noReason = await move(b, lead.id, 'lost').expect(400);
      expect(noReason.body.details.lostReasonId).toBeDefined();
      await move(b, lead.id, 'lost', { lostReasonId: 'nonexistent' }).expect(400);
      expect(await stageOf(b, lead.id)).toBe('new');
      expect(
        await t.db.prisma.statusHistory.count({
          where: { workspaceId: b.workspaceId, entityId: lead.id },
        }),
      ).toBe(1);

      const reasons = (await http.get('/settings/lost-reasons', b.token)).body.data as Json[];
      const price = reasons.find((r) => r.name === 'Price too high') as Json;
      await move(b, lead.id, 'lost', { lostReasonId: price.id, note: 'Found it cheaper' }).expect(
        200,
      );
      const lost = (await http.get(`/leads/${lead.id}`, b.token)).body.data;
      expect(lost).toMatchObject({ stage: 'lost', lostReasonId: price.id });
      expect(lost.closedAt).not.toBeNull();

      // a deactivated reason cannot be chosen
      await http
        .patch(`/settings/lost-reasons/${price.id}`, { active: false }, b.token)
        .expect(200);
      const second = (
        await createLead(b, { fullName: 'Another', phone: '0321-7654321' }).expect(201)
      ).body.data as Json;
      await move(b, second.id, 'lost', { lostReasonId: price.id }).expect(400);
    });

    it('closes the lead when it is won', async () => {
      const b = await business();
      const lead = (await createLead(b).expect(201)).body.data as Json;
      await move(b, lead.id, 'won').expect(200);
      const won = (await http.get(`/leads/${lead.id}`, b.token)).body.data;
      expect(won.stage).toBe('won');
      expect(won.closedAt).not.toBeNull();
    });
  });

  describe('dedup window (9.7)', () => {
    it('returns the first lead when the same phone arrives again, in any format', async () => {
      const b = await business();
      const first = await createLead(b, { fullName: 'First Contact' }).expect(201);
      for (const written of ['+92 300 1234567', '923001234567', '(0300) 123 4567']) {
        const again = await createLead(b, { fullName: 'Second Try', phone: written }).expect(200);
        expect(again.body.data).toMatchObject({
          id: first.body.data.id,
          existing: true,
          fullName: 'First Contact',
        });
      }
      expect(await t.db.prisma.lead.count({ where: { workspaceId: b.workspaceId } })).toBe(1);
    });

    it('matches by email too; closed leads, old leads and other workspaces do not count; allowDuplicate overrides', async () => {
      const b = await business();
      const a = (await createLead(b, { phone: undefined, email: 'dup@x.test' }).expect(201)).body
        .data as Json;
      expect(
        (await createLead(b, { phone: undefined, email: 'DUP@x.test' }).expect(200)).body.data.id,
      ).toBe(a.id);

      await move(b, a.id, 'won').expect(200); // closed: a new enquiry is a new lead
      const fresh = (await createLead(b, { phone: undefined, email: 'dup@x.test' }).expect(201))
        .body.data as Json;
      expect(fresh.id).not.toBe(a.id);

      await t.db.prisma.lead.update({
        where: { id: fresh.id },
        data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
      }); // outside 24 h
      const later = await createLead(b, { phone: undefined, email: 'dup@x.test' }).expect(201);
      expect(later.body.data.id).not.toBe(fresh.id);

      const forced = await createLead(b, {
        phone: undefined,
        email: 'dup@x.test',
        allowDuplicate: true,
      }).expect(201);
      expect(forced.body.data.id).not.toBe(later.body.data.id);

      const other = await business();
      expect(
        (await createLead(other, { phone: undefined, email: 'dup@x.test' }).expect(201)).body.data
          .id,
      ).not.toBe(a.id);
    });

    it('honours a workspace-configured window, and 0 turns it off', async () => {
      const b = await business();
      await http.patch('/settings', { sales: { leadDedupWindowHours: 0 } }, b.token).expect(200);
      const one = await createLead(b).expect(201);
      const two = await createLead(b).expect(201);
      expect(two.body.data.id).not.toBe(one.body.data.id);
    });
  });

  describe('update, assignment and who sees what (9.3)', () => {
    it('updates with optimistic concurrency and logs key field changes', async () => {
      const b = await business();
      const lead = (await createLead(b, { estimatedValue: '100000' }).expect(201)).body
        .data as Json;
      const patched = await http
        .patch(
          `/leads/${lead.id}`,
          { version: 1, estimatedValue: '120000', priority: 'HIGH', nextAction: 'Send catalogue' },
          b.token,
        )
        .expect(200);
      expect(patched.body.data).toMatchObject({
        estimatedValue: '120000',
        priority: 'HIGH',
        version: 2,
      });
      const stale = await http
        .patch(`/leads/${lead.id}`, { version: 1, priority: 'LOW' }, b.token)
        .expect(409);
      expect(stale.body.code).toBe('STALE_VERSION');
      await http.patch(`/leads/${lead.id}`, { priority: 'LOW' }, b.token).expect(400);

      const timeline = (await http.get(`/leads/${lead.id}/timeline`, b.token)).body.data as Json[];
      expect(timeline.map((e) => e.summary)).toEqual(
        expect.arrayContaining([
          'Estimated value changed from "100000" to "120000"',
          'Priority changed from "MEDIUM" to "HIGH"',
          'Next action changed from empty to "Send catalogue"',
        ]),
      );
      expect(
        await t.db.prisma.auditEvent.count({
          where: { workspaceId: b.workspaceId, action: 'lead.update', entityId: lead.id },
        }),
      ).toBe(1);
    });

    it('assigns with lead:assign only, and records it on the timeline', async () => {
      const b = await business();
      const sales = await member(b, 'Salesperson');
      const lead = (await createLead(b).expect(201)).body.data as Json;
      await http
        .post(`/leads/${lead.id}/assign`, { assignedToId: sales.userId }, sales.token)
        .expect(403);
      const assigned = await http
        .post(`/leads/${lead.id}/assign`, { assignedToId: sales.userId }, b.token)
        .expect(200);
      expect(assigned.body.data.assignedToId).toBe(sales.userId);
      await http.post(`/leads/${lead.id}/assign`, { assignedToId: 'nobody' }, b.token).expect(400);
      const timeline = (await http.get(`/leads/${lead.id}/timeline`, b.token)).body.data as Json[];
      expect(
        timeline
          .map((e) => e.summary)
          .some((s: string) => s.startsWith('Assigned to Salesperson Person')),
      ).toBe(true);
      const unassigned = await http
        .post(`/leads/${lead.id}/assign`, { assignedToId: null }, b.token)
        .expect(200);
      expect(unassigned.body.data.assignedToId).toBeNull();
    });

    it('shows a salesperson only their own leads unless they hold lead:view_all', async () => {
      const b = await business();
      const sales = await member(b, 'Salesperson');
      const other = await member(b, 'Salesperson');
      const mine = (
        await createLead(sales, { fullName: 'Mine', phone: '0300-1000001' }).expect(201)
      ).body.data as Json;
      const assignedToMe = (
        await createLead(b, {
          fullName: 'Given to me',
          phone: '0300-1000002',
          assignedToId: sales.userId,
        }).expect(201)
      ).body.data as Json;
      const theirs = (
        await createLead(b, { fullName: 'Not mine', phone: '0300-1000003' }).expect(201)
      ).body.data as Json;

      const seen = ((await http.get('/leads', sales.token).expect(200)).body.data as Json[])
        .map((l) => l.fullName)
        .sort();
      expect(seen).toEqual(['Given to me', 'Mine']);
      await http.get(`/leads/${theirs.id}`, sales.token).expect(404);
      await http
        .patch(`/leads/${theirs.id}`, { version: 1, priority: 'LOW' }, sales.token)
        .expect(404);
      await move(sales, theirs.id, 'contacted').expect(404);
      await http.get(`/leads/${theirs.id}/timeline`, sales.token).expect(404);
      await http.get(`/leads/${mine.id}`, sales.token).expect(200);
      await http.get(`/leads/${assignedToMe.id}`, sales.token).expect(200);
      await http.get(`/leads/${mine.id}`, other.token).expect(404);

      expect((await http.get('/leads', b.token)).body.data as Json[]).toHaveLength(3);
      const pipeline = (await http.get('/leads/pipeline', sales.token).expect(200)).body
        .data as Json[];
      expect(pipeline.find((c) => c.stage === 'new')?.count).toBe(2);
      expect(
        (await http.get('/leads/analytics', sales.token).expect(200)).body.data.conversion.total,
      ).toBe(2);
    });
  });

  describe('lists and the pipeline board (9.1)', () => {
    it('filters, searches and pages, and builds one column per stage with counts and values', async () => {
      const b = await business();
      const mk = async (fullName: string, phone: string, extra: object = {}) =>
        (await createLead(b, { fullName, phone, ...extra }).expect(201)).body.data as Json;
      const a = await mk('Anna Ali', '0300-2000001', {
        estimatedValue: '1000.50',
        priority: 'HIGH',
        source: 'STORE',
      });
      const c = await mk('Carl Chaudhry', '0300-2000002', {
        estimatedValue: '2000',
        interest: 'dining table',
      });
      const d = await mk('Dana Dar', '0300-2000003', { estimatedValue: '500' });
      await move(b, c.id, 'qualified').expect(200);
      await move(b, d.id, 'won').expect(200);

      const names = async (qs: string) =>
        ((await http.get(`/leads${qs}`, b.token).expect(200)).body.data as Json[])
          .map((l) => l.fullName)
          .sort();
      expect(await names('')).toEqual(['Anna Ali', 'Carl Chaudhry', 'Dana Dar']);
      expect(await names('?stage=qualified')).toEqual(['Carl Chaudhry']);
      expect(await names('?priority=HIGH')).toEqual(['Anna Ali']);
      expect(await names('?source=STORE')).toEqual(['Anna Ali']);
      expect(await names('?q=dining')).toEqual(['Carl Chaudhry']);
      expect(await names('?state=open')).toEqual(['Anna Ali', 'Carl Chaudhry']);
      expect(await names('?state=closed')).toEqual(['Dana Dar']);
      await http.get('/leads?cf.nothing=1', b.token).expect(400);
      const p1 = await http.get('/leads?limit=2', b.token).expect(200);
      const p2 = await http
        .get(`/leads?limit=2&cursor=${p1.body.meta.nextCursor}`, b.token)
        .expect(200);
      expect(p1.body.data.length + p2.body.data.length).toBe(3);

      const board = (await http.get('/leads/pipeline', b.token).expect(200)).body.data as Json[];
      expect(board.map((col) => col.stage)).toEqual([
        'new',
        'contacted',
        'qualified',
        'quoted',
        'negotiation',
        'won',
        'lost',
      ]);
      const col = (stage: string) => board.find((x) => x.stage === stage) as Json;
      expect(col('new')).toMatchObject({
        count: 1,
        value: '1000.5',
        label: 'New',
        systemRole: 'NEW',
      });
      expect(col('new').cards[0]).toMatchObject({
        id: a.id,
        fullName: 'Anna Ali',
        priority: 'HIGH',
      });
      expect(col('qualified')).toMatchObject({ count: 1, value: '2000' });
      expect(col('won')).toMatchObject({ count: 1, value: '500' });
      expect(col('lost')).toMatchObject({ count: 0, value: '0', cards: [] });
      expect(col('contacted').acceptsFrom).toEqual(expect.arrayContaining(['new', 'qualified']));
      expect(col('new').acceptsFrom).not.toContain('new');
      expect(col('won').acceptsFrom).not.toContain('won');
    });
  });

  describe('conversion to a customer (9.4)', () => {
    it('creates a customer from the lead, once', async () => {
      const b = await business();
      const lead = (
        await createLead(b, {
          email: 'sana@x.test',
          source: 'SOCIAL',
          channel: 'INSTAGRAM',
          campaign: 'Eid',
        }).expect(201)
      ).body.data as Json;
      const res = await http
        .post(`/leads/${lead.id}/convert`, { target: 'CUSTOMER' }, b.token)
        .expect(200);
      expect(res.body.data.created).toBe(true);
      expect(res.body.data.customer).toMatchObject({
        fullName: 'Sana Malik',
        phones: ['0300-1234567'],
        email: 'sana@x.test',
        source: 'SOCIAL',
        channel: 'INSTAGRAM',
        campaign: 'Eid',
      });
      expect(res.body.data.lead.customerId).toBe(res.body.data.customer.id);
      const row = await t.db.prisma.customer.findUniqueOrThrow({
        where: { id: res.body.data.customer.id },
      });
      expect(row.phonesNormalized).toEqual(['+923001234567']);

      const again = await http
        .post(`/leads/${lead.id}/convert`, { target: 'CUSTOMER' }, b.token)
        .expect(200);
      expect(again.body.data).toMatchObject({ created: false });
      expect(again.body.data.customer.id).toBe(res.body.data.customer.id);
      expect(
        await t.db.prisma.customer.count({
          where: { workspaceId: b.workspaceId, isWalkIn: false },
        }),
      ).toBe(1);

      // the customer's timeline shows the conversion and the lead's history
      const timeline = (
        await http.get(`/customers/${res.body.data.customer.id}/timeline`, b.token).expect(200)
      ).body.data as Json[];
      const summaries = timeline.map((e) => e.summary);
      expect(summaries).toEqual(
        expect.arrayContaining([
          'Converted to a new customer',
          'Lead created',
          'Customer record created',
        ]),
      );
      await http.post(`/leads/${lead.id}/convert`, { target: 'INVOICE' }, b.token).expect(400);
    });

    it('links an existing customer with the same phone or email instead of duplicating it', async () => {
      const b = await business();
      const customer = (
        await http
          .post('/customers', { fullName: 'Sana M.', phones: ['+92 300 1234567'] }, b.token)
          .expect(201)
      ).body.data as Json;
      const lead = (await createLead(b).expect(201)).body.data as Json;
      const res = await http
        .post(`/leads/${lead.id}/convert`, { target: 'CUSTOMER' }, b.token)
        .expect(200);
      expect(res.body.data).toMatchObject({ created: false });
      expect(res.body.data.customer.id).toBe(customer.id);
      expect(
        await t.db.prisma.customer.count({
          where: { workspaceId: b.workspaceId, isWalkIn: false },
        }),
      ).toBe(1);

      const forceNew = (
        await createLead(b, { fullName: 'Other', phone: '0300-7777777' }).expect(201)
      ).body.data as Json;
      await http
        .post('/customers', { fullName: 'Match', phones: ['0300-7777777'] }, b.token)
        .expect(201);
      const created = await http
        .post(`/leads/${forceNew.id}/convert`, { target: 'CUSTOMER', createNew: true }, b.token)
        .expect(200);
      expect(created.body.data.created).toBe(true);
      const explicit = (
        await createLead(b, { fullName: 'Explicit', phone: '0300-8888888' }).expect(201)
      ).body.data as Json;
      const linked = await http
        .post(
          `/leads/${explicit.id}/convert`,
          { target: 'CUSTOMER', customerId: customer.id },
          b.token,
        )
        .expect(200);
      expect(linked.body.data.customer.id).toBe(customer.id);
      await http
        .post(`/leads/${explicit.id}/convert`, { target: 'CUSTOMER', customerId: 'nope' }, b.token)
        .expect(400);
    });
  });

  describe('analytics (9.6)', () => {
    it('reports count and value by stage, time in stage, conversion and top lost reasons', async () => {
      const b = await business();
      const reasons = (await http.get('/settings/lost-reasons', b.token)).body.data as Json[];
      const price = reasons.find((r) => r.name === 'Price too high') as Json;
      const rival = reasons.find((r) => r.name === 'Chose a competitor') as Json;
      const mk = async (i: number, estimatedValue: string) =>
        (
          await createLead(b, {
            fullName: `L${i}`,
            phone: `0300-30000${String(i).padStart(2, '0')}`,
            estimatedValue,
          }).expect(201)
        ).body.data as Json;
      const [l1, l2, l3, l4, l5] = await Promise.all([1, 2, 3, 4, 5].map((i) => mk(i, '1000')));
      await move(b, l1!.id, 'won').expect(200);
      await move(b, l2!.id, 'lost', { lostReasonId: price.id }).expect(200);
      await move(b, l3!.id, 'lost', { lostReasonId: price.id }).expect(200);
      await move(b, l4!.id, 'lost', { lostReasonId: rival.id }).expect(200);
      await move(b, l5!.id, 'contacted').expect(200);
      // make the creation of L5 two days old so time-in-stage is measurable
      await t.db.prisma.statusHistory.updateMany({
        where: { workspaceId: b.workspaceId, entityId: l5!.id, toKey: 'new' },
        data: { createdAt: new Date(Date.now() - 2 * 86_400_000) },
      });
      await t.db.prisma.statusHistory.updateMany({
        where: { workspaceId: b.workspaceId, entityId: l5!.id, toKey: 'contacted' },
        data: { createdAt: new Date(Date.now() - 1 * 86_400_000) },
      });

      const res = (await http.get('/leads/analytics', b.token).expect(200)).body.data as Json;
      const stage = (key: string) => res.byStage.find((s: Json) => s.stage === key);
      expect(stage('won')).toMatchObject({ count: 1, value: '1000' });
      expect(stage('lost')).toMatchObject({ count: 3, value: '3000' });
      expect(stage('contacted')).toMatchObject({ count: 1 });
      expect(res.conversion).toEqual({ total: 5, won: 1, rate: '0.2' });
      expect(res.topLostReasons).toEqual([
        { reasonId: price.id, name: 'Price too high', count: 2 },
        { reasonId: rival.id, name: 'Chose a competitor', count: 1 },
      ]);
      const inNew = res.avgDaysInStage.find((s: Json) => s.stage === 'new');
      expect(Number(inNew.avgDays)).toBeGreaterThanOrEqual(0.2); // L5 spent a day in New, the others moments
      expect(inNew.samples).toBe(5);
      expect(res.avgDaysInStage.map((s: Json) => s.stage)).not.toContain('won');

      const none = (
        await http.get('/leads/analytics?from=2000-01-01&to=2000-02-01', b.token).expect(200)
      ).body.data as Json;
      expect(none.conversion).toEqual({ total: 0, won: 0, rate: '0' });
    });
  });

  describe('attachments and isolation', () => {
    it('lists the reference images attached to a lead', async () => {
      const b = await business();
      const lead = (await createLead(b).expect(201)).body.data as Json;
      const png = await sharp({
        create: { width: 40, height: 40, channels: 3, background: '#445566' },
      })
        .png()
        .toBuffer();
      const upload = await request(app.getHttpServer())
        .post('/api/v1/files')
        .set('Authorization', `Bearer ${b.token}`)
        .set('X-Forwarded-For', '10.77.0.1')
        .field('entityType', 'LEAD')
        .field('entityId', lead.id)
        .field('purpose', 'reference')
        .attach('file', png, { filename: 'sofa-idea.png', contentType: 'image/png' })
        .expect(201);
      const files = (await http.get(`/leads/${lead.id}/attachments`, b.token).expect(200)).body
        .data as Json[];
      expect(files).toEqual([
        expect.objectContaining({
          id: upload.body.data.id,
          name: 'sofa-idea.png',
          purpose: 'reference',
        }),
      ]);
    });

    it('another workspace cannot see or change a lead', async () => {
      const a = await business();
      const other = await business();
      const lead = (await createLead(a).expect(201)).body.data as Json;
      await http.get(`/leads/${lead.id}`, other.token).expect(404);
      await http
        .patch(`/leads/${lead.id}`, { version: 1, priority: 'LOW' }, other.token)
        .expect(404);
      await move(other, lead.id, 'won').expect(404);
      await http.post(`/leads/${lead.id}/convert`, { target: 'CUSTOMER' }, other.token).expect(404);
      await http.get(`/leads/${lead.id}/attachments`, other.token).expect(404);
      expect((await http.get('/leads', other.token)).body.data).toEqual([]);
    });

    it('enforces lead permissions', async () => {
      const b = await business();
      const viewer = await member(b, 'Viewer');
      const lead = (await createLead(b).expect(201)).body.data as Json;
      await http.get('/leads', viewer.token).expect(200);
      await http.post('/leads', { fullName: 'x' }, viewer.token).expect(403);
      await http
        .patch(`/leads/${lead.id}`, { version: 1, priority: 'LOW' }, viewer.token)
        .expect(403);
      await move(viewer, lead.id, 'won').expect(403);
      await http
        .post(`/leads/${lead.id}/convert`, { target: 'CUSTOMER' }, viewer.token)
        .expect(403);
    });
  });
});
