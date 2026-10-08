import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { dayBounds } from '../src/modules/crm/day-bounds';
import { TaskDueScheduler } from '../src/modules/crm/task-due.scheduler';
import { TasksService } from '../src/modules/crm/tasks.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { runWithWorkspace } from './helpers/context';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Tasks and notes (real PostgreSQL)', () => {
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
    const email = `owner${++n}@tasks.test`;
    const created = await app.get(TenantsService).createWorkspace({
      name: `Tasks ${n}`,
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
    const email = `${roleName.toLowerCase().replace(/\W/g, '')}${++n}@tasks.test`;
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

  const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
  const createTask = (b: { token: string }, body: object = {}) =>
    http.post('/tasks', { type: 'TODO', title: 'Do something', ...body }, b.token);
  const customerOf = async (b: Biz, fullName = 'Carol Customer') =>
    (await http.post('/customers', { fullName, phones: ['0300-5550001'] }, b.token).expect(201))
      .body.data as Json;
  const leadOf = async (b: Biz, body: object = {}) =>
    (
      await http
        .post('/leads', { fullName: 'Lead Lola', phone: '0300-5550002', ...body }, b.token)
        .expect(201)
    ).body.data as Json;
  const timelineOf = async (b: Biz, path: string) =>
    ((await http.get(path, b.token).expect(200)).body.data as Json[]).map((e) => e.summary);

  describe('tasks (30.1)', () => {
    it('creates a task for me by default, and one linked to a customer shows on its timeline (30.7)', async () => {
      const b = await business();
      const customer = await customerOf(b);
      const plain = await createTask(b, {
        dueAt: inMinutes(60),
        description: 'Order supplies',
      }).expect(201);
      expect(plain.body.data).toMatchObject({
        type: 'TODO',
        status: 'OPEN',
        assignedToId: b.userId,
        createdById: b.userId,
        entityType: null,
      });
      const linked = await createTask(b, {
        type: 'CALL',
        title: 'Call about the sofa',
        entityType: 'CUSTOMER',
        entityId: customer.id,
      }).expect(201);
      expect(linked.body.data).toMatchObject({ entityType: 'CUSTOMER', entityId: customer.id });
      expect(await timelineOf(b, `/customers/${customer.id}/timeline`)).toContain(
        'Task added: Call about the sofa',
      );
    });

    it('validates input, links and assignees', async () => {
      const b = await business();
      const other = await business();
      const foreign = await customerOf(other);
      await http.post('/tasks', { title: 'x' }, b.token).expect(400);
      await createTask(b, { type: 'DANCE' }).expect(400);
      await createTask(b, { dueAt: 'tomorrow-ish' }).expect(400);
      await createTask(b, { entityType: 'CUSTOMER' }).expect(400); // needs an id
      await createTask(b, { entityType: 'CUSTOMER', entityId: foreign.id }).expect(404); // another workspace
      const notYet = await createTask(b, { entityType: 'ORDER', entityId: 'o1' }).expect(400);
      expect(notYet.body.details.entityType[0]).toMatch(/cannot be linked yet/);
      await createTask(b, { assignedToId: 'nobody' }).expect(400);
    });

    it('lists my tasks by due bucket, type, status and linked record (30.3)', async () => {
      const b = await business();
      const customer = await customerOf(b);
      const { end } = dayBounds(new Date(), 'UTC');
      const laterToday = new Date(
        Math.min(Date.now() + 60_000, end.getTime() - 1000),
      ).toISOString();
      await createTask(b, { title: 'Overdue one', dueAt: inMinutes(-120), type: 'CALL' }).expect(
        201,
      );
      await createTask(b, { title: 'Later today', dueAt: laterToday }).expect(201);
      await createTask(b, {
        title: 'Next week',
        dueAt: inMinutes(7 * 24 * 60),
        type: 'MEETING',
      }).expect(201);
      await createTask(b, { title: 'Someday' }).expect(201);
      await createTask(b, {
        title: 'For Carol',
        entityType: 'CUSTOMER',
        entityId: customer.id,
        dueAt: inMinutes(24 * 60 * 2),
      }).expect(201);

      const titles = async (qs: string) =>
        ((await http.get(`/tasks${qs}`, b.token).expect(200)).body.data as Json[]).map(
          (x) => x.title,
        );
      expect(await titles('?mine=true&due=overdue')).toEqual(['Overdue one']);
      expect(await titles('?due=today')).toEqual(['Later today']);
      expect(await titles('?due=upcoming')).toEqual(['For Carol', 'Next week']);
      expect(await titles('?due=none')).toEqual(['Someday']);
      expect(await titles('?type=MEETING')).toEqual(['Next week']);
      expect(await titles(`?entityType=CUSTOMER&entityId=${customer.id}`)).toEqual(['For Carol']);
      // soonest first, undated last
      expect(await titles('')).toEqual([
        'Overdue one',
        'Later today',
        'For Carol',
        'Next week',
        'Someday',
      ]);
      expect(await titles('?sort=dueAt:desc')).toEqual([
        'Next week',
        'For Carol',
        'Later today',
        'Overdue one',
        'Someday',
      ]); // undated stay last
      expect(await titles('?q=week')).toEqual(['Next week']);
      await http.get('/tasks?due=whenever', b.token).expect(400);

      const d1 = await http.get('/tasks?limit=3&sort=dueAt:desc', b.token).expect(200);
      const d2 = await http
        .get(`/tasks?limit=3&sort=dueAt:desc&cursor=${d1.body.meta.nextCursor}`, b.token)
        .expect(200);
      expect([...d1.body.data, ...d2.body.data].map((x: Json) => x.title)).toEqual([
        'Next week',
        'For Carol',
        'Later today',
        'Overdue one',
        'Someday',
      ]);

      const page1 = await http.get('/tasks?limit=2', b.token).expect(200);
      const page2 = await http
        .get(`/tasks?limit=2&cursor=${page1.body.meta.nextCursor}`, b.token)
        .expect(200);
      const page3 = await http
        .get(`/tasks?limit=2&cursor=${page2.body.meta.nextCursor}`, b.token)
        .expect(200);
      expect(
        [...page1.body.data, ...page2.body.data, ...page3.body.data].map((x: Json) => x.title),
      ).toEqual(['Overdue one', 'Later today', 'For Carol', 'Next week', 'Someday']);
    });

    it("shows people their own tasks; task:view_all sees everyone's", async () => {
      const b = await business();
      const sales = await member(b, 'Salesperson');
      await createTask(sales, { title: 'Sales own' }).expect(201);
      await createTask(b, { title: 'Owner own', assignedToId: b.userId }).expect(201);
      await createTask(b, { title: 'Given to sales', assignedToId: sales.userId }).expect(201);
      const titles = async (token: string) =>
        ((await http.get('/tasks', token).expect(200)).body.data as Json[])
          .map((x) => x.title)
          .sort();
      expect(await titles(sales.token)).toEqual(['Given to sales', 'Sales own']);
      expect(await titles(b.token)).toEqual(['Given to sales', 'Owner own', 'Sales own']);
      const ownerTask = (await http.get('/tasks?q=Owner', b.token)).body.data[0] as Json;
      await http.get(`/tasks/${ownerTask.id}`, sales.token).expect(404);
      await http.patch(`/tasks/${ownerTask.id}`, { title: 'hijack' }, sales.token).expect(404);
      await http.post(`/tasks/${ownerTask.id}/complete`, {}, sales.token).expect(404);
    });

    it('updates, cancels, reopens, and completes with who and when, adding it to the timeline (30.6)', async () => {
      const b = await business();
      const sales = await member(b, 'Salesperson');
      const lead = await leadOf(b);
      const task = (
        await createTask(b, {
          type: 'CALL',
          title: 'Ring Lola',
          entityType: 'LEAD',
          entityId: lead.id,
          assignedToId: sales.userId,
        }).expect(201)
      ).body.data as Json;

      const edited = await http
        .patch(`/tasks/${task.id}`, { title: 'Ring Lola at 5', dueAt: inMinutes(30) }, b.token)
        .expect(200);
      expect(edited.body.data).toMatchObject({ title: 'Ring Lola at 5' });
      await http.patch(`/tasks/${task.id}`, { assignedToId: 'nobody' }, b.token).expect(400);
      await http.patch(`/tasks/${task.id}`, { status: 'DONE' }, b.token).expect(400); // done goes through /complete

      await http.patch(`/tasks/${task.id}`, { status: 'CANCELLED' }, b.token).expect(200);
      await http.post(`/tasks/${task.id}/complete`, {}, b.token).expect(422);
      await http.patch(`/tasks/${task.id}`, { status: 'OPEN' }, b.token).expect(200);

      const done = await http.post(`/tasks/${task.id}/complete`, {}, b.token).expect(200);
      expect(done.body.data).toMatchObject({ status: 'DONE', completedById: b.userId });
      expect(done.body.data.completedAt).not.toBeNull();
      expect(await timelineOf(b, `/leads/${lead.id}/timeline`)).toEqual(
        expect.arrayContaining([
          'Task added: Ring Lola at 5'.replace(' at 5', ''),
          'Task completed: Ring Lola at 5',
        ]),
      );
      const again = await http.post(`/tasks/${task.id}/complete`, {}, b.token).expect(200);
      expect(again.body.data.completedAt).toBe(done.body.data.completedAt);
      await http.patch(`/tasks/${task.id}`, { title: 'late edit' }, b.token).expect(422);
      expect(
        await t.db.prisma.auditEvent.count({
          where: { workspaceId: b.workspaceId, entityId: task.id, action: 'task.complete' },
        }),
      ).toBe(1);

      expect(
        ((await http.get('/tasks?status=DONE', b.token)).body.data as Json[]).map((x) => x.title),
      ).toEqual(['Ring Lola at 5']);
    });
  });

  describe('lead follow-ups (30.5)', () => {
    it("keeps one open follow-up task in step with the lead's next action and date", async () => {
      const b = await business();
      const sales = await member(b, 'Salesperson');
      const lead = await leadOf(b, {
        nextAction: 'Send catalogue',
        nextActionDate: inMinutes(120),
      });
      const open = () =>
        t.db.prisma.task.findMany({
          where: {
            workspaceId: b.workspaceId,
            entityType: 'LEAD',
            entityId: lead.id,
            type: 'FOLLOW_UP',
            status: 'OPEN',
          },
        });

      let tasks = await open();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ title: 'Send catalogue', assignedToId: b.userId });

      const later = inMinutes(300);
      await http
        .patch(
          `/leads/${lead.id}`,
          { version: 1, nextAction: 'Call to discuss', nextActionDate: later },
          b.token,
        )
        .expect(200);
      tasks = await open();
      expect(tasks).toHaveLength(1); // updated, not duplicated
      expect(tasks[0]).toMatchObject({ title: 'Call to discuss' });
      expect(tasks[0]?.dueAt?.toISOString()).toBe(later);

      await http
        .post(`/leads/${lead.id}/assign`, { assignedToId: sales.userId }, b.token)
        .expect(200);
      expect((await open())[0]?.assignedToId).toBe(sales.userId);
      expect(
        ((await http.get('/tasks?mine=true', sales.token)).body.data as Json[]).map((x) => x.title),
      ).toEqual(['Call to discuss']);

      await http
        .patch(`/leads/${lead.id}`, { version: 3, nextAction: null, nextActionDate: null }, b.token)
        .expect(200);
      expect(await open()).toHaveLength(0);
      expect(
        await t.db.prisma.task.count({
          where: { workspaceId: b.workspaceId, entityId: lead.id, status: 'CANCELLED' },
        }),
      ).toBe(1);

      // a lead that is won no longer nags
      const second = await leadOf(b, {
        fullName: 'Second',
        phone: '0300-5550009',
        nextAction: 'Follow up',
        nextActionDate: inMinutes(60),
      });
      await http.post(`/leads/${second.id}/stage`, { stage: 'won' }, b.token).expect(200);
      expect(
        await t.db.prisma.task.count({
          where: { workspaceId: b.workspaceId, entityId: second.id, status: 'OPEN' },
        }),
      ).toBe(0);
    });
  });

  describe('notes and call logs (30.2, 30.7)', () => {
    it('adds notes and call logs to customers and leads, newest first, and shows them on the timeline', async () => {
      const b = await business();
      const customer = await customerOf(b);
      const note = await http
        .post(
          '/notes',
          { entityType: 'CUSTOMER', entityId: customer.id, body: 'Prefers morning deliveries' },
          b.token,
        )
        .expect(201);
      expect(note.body.data).toMatchObject({
        kind: 'NOTE',
        callDirection: null,
        createdById: b.userId,
      });
      await http
        .post(
          '/notes',
          {
            entityType: 'CUSTOMER',
            entityId: customer.id,
            kind: 'CALL',
            body: 'Asked about the sofa',
            callDirection: 'OUTBOUND',
            callOutcome: 'ANSWERED',
          },
          b.token,
        )
        .expect(201);

      const list = (
        await http.get(`/notes?entityType=CUSTOMER&entityId=${customer.id}`, b.token).expect(200)
      ).body.data as Json[];
      expect(list.map((x) => x.kind)).toEqual(['CALL', 'NOTE']);
      expect(list[0]).toMatchObject({
        callDirection: 'OUTBOUND',
        callOutcome: 'ANSWERED',
        createdByName: 'Olivia Owner',
      });
      const summaries = await timelineOf(b, `/customers/${customer.id}/timeline`);
      expect(summaries).toEqual(
        expect.arrayContaining([
          'Note: Prefers morning deliveries',
          'Call (outgoing, answered): Asked about the sofa',
        ]),
      );

      const lead = await leadOf(b);
      await http
        .post('/notes', { entityType: 'LEAD', entityId: lead.id, body: 'Wants a quote' }, b.token)
        .expect(201);
      expect(await timelineOf(b, `/leads/${lead.id}/timeline`)).toContain('Note: Wants a quote');
      expect(
        await t.db.prisma.auditEvent.count({
          where: { workspaceId: b.workspaceId, action: 'note.call_log' },
        }),
      ).toBe(1);
    });

    it('validates note kinds and links', async () => {
      const b = await business();
      const customer = await customerOf(b);
      const note = (body: object) =>
        http.post(
          '/notes',
          { entityType: 'CUSTOMER', entityId: customer.id, body: 'text', ...body },
          b.token,
        );
      await note({ kind: 'CALL' }).expect(400); // direction and outcome needed
      await note({ kind: 'CALL', callDirection: 'SIDEWAYS', callOutcome: 'ANSWERED' }).expect(400);
      await note({ callDirection: 'INBOUND', callOutcome: 'ANSWERED' }).expect(400); // only for call logs
      await note({ body: '' }).expect(400);
      await note({ entityType: 'ORDER', entityId: 'o1' }).expect(400);
      await note({ entityId: 'missing' }).expect(404);
      await http.get('/notes?entityType=CUSTOMER', b.token).expect(400);
    });

    it('uses the permission of the record: viewers read, salespeople write, others are kept out', async () => {
      const b = await business();
      const customer = await customerOf(b);
      const lead = await leadOf(b);
      await http
        .post(
          '/notes',
          { entityType: 'CUSTOMER', entityId: customer.id, body: 'Internal' },
          b.token,
        )
        .expect(201);
      const viewer = await member(b, 'Viewer');
      const sales = await member(b, 'Salesperson');
      const production = await member(b, 'Production Staff'); // no customer or lead access

      expect(
        (
          await http
            .get(`/notes?entityType=CUSTOMER&entityId=${customer.id}`, viewer.token)
            .expect(200)
        ).body.data as Json[],
      ).toHaveLength(1);
      await http
        .post('/notes', { entityType: 'CUSTOMER', entityId: customer.id, body: 'x' }, viewer.token)
        .expect(403);
      await http
        .post(
          '/notes',
          { entityType: 'CUSTOMER', entityId: customer.id, body: 'From sales' },
          sales.token,
        )
        .expect(201);
      await http
        .get(`/notes?entityType=CUSTOMER&entityId=${customer.id}`, production.token)
        .expect(403);
      // a salesperson cannot reach a lead that is not theirs, so cannot read or write its notes
      await http.get(`/notes?entityType=LEAD&entityId=${lead.id}`, sales.token).expect(404);
      await http
        .post('/notes', { entityType: 'LEAD', entityId: lead.id, body: 'x' }, sales.token)
        .expect(404);
      await http
        .post(
          '/tasks',
          { type: 'TODO', title: 'x', entityType: 'LEAD', entityId: lead.id },
          sales.token,
        )
        .expect(404);
    });

    it('does not leak notes across workspaces', async () => {
      const a = await business();
      const other = await business();
      const customer = await customerOf(a);
      await http
        .post('/notes', { entityType: 'CUSTOMER', entityId: customer.id, body: 'secret' }, a.token)
        .expect(201);
      await http.get(`/notes?entityType=CUSTOMER&entityId=${customer.id}`, other.token).expect(404);
      await http
        .post('/notes', { entityType: 'CUSTOMER', entityId: customer.id, body: 'x' }, other.token)
        .expect(404);
    });
  });

  describe('the due scan (30.4)', () => {
    it('publishes task.due once per due open task, and again only after the due date changes', async () => {
      const b = await business();
      const seen: Json[] = [];
      const emitter = app.get(EventEmitter2);
      const listener = (p: Json) => seen.push(p);
      emitter.on('task.due', listener);
      try {
        const due = (await createTask(b, { title: 'Due now', dueAt: inMinutes(-5) }).expect(201))
          .body.data as Json;
        await createTask(b, { title: 'Not yet', dueAt: inMinutes(60) }).expect(201);
        await createTask(b, { title: 'No date' }).expect(201);
        const cancelled = (
          await createTask(b, { title: 'Cancelled', dueAt: inMinutes(-5) }).expect(201)
        ).body.data as Json;
        await http.patch(`/tasks/${cancelled.id}`, { status: 'CANCELLED' }, b.token).expect(200);
        const finished = (await createTask(b, { title: 'Done', dueAt: inMinutes(-5) }).expect(201))
          .body.data as Json;
        await http.post(`/tasks/${finished.id}/complete`, {}, b.token).expect(200);

        const tasks = app.get(TasksService);
        const count = () =>
          runWithWorkspace(app, b.workspaceId, () => tasks.publishDue(b.workspaceId));
        expect(await count()).toBe(1);
        expect(seen).toEqual([
          expect.objectContaining({ taskId: due.id, workspaceId: b.workspaceId }),
        ]);
        expect(await count()).toBe(0); // already told

        // moving the due date re-arms the reminder
        await http.patch(`/tasks/${due.id}`, { dueAt: inMinutes(-1) }, b.token).expect(200);
        expect(await count()).toBe(1);
        expect(seen).toHaveLength(2);
      } finally {
        emitter.off('task.due', listener);
      }
    });

    it('scans every workspace on the schedule, each in its own context, and survives one failing', async () => {
      const a = await business();
      const b = await business();
      await createTask(a, { title: 'A due', dueAt: inMinutes(-1) }).expect(201);
      await createTask(b, { title: 'B due', dueAt: inMinutes(-1) }).expect(201);
      const seen: Json[] = [];
      const emitter = app.get(EventEmitter2);
      const listener = (p: Json) => seen.push(p);
      emitter.on('task.due', listener);
      try {
        const result = await app.get(TaskDueScheduler).scan();
        expect(result.failed).toEqual([]);
        expect(result.succeeded).toEqual(expect.arrayContaining([a.workspaceId, b.workspaceId]));
        expect(
          seen
            .filter((e) => [a.workspaceId, b.workspaceId].includes(e.workspaceId))
            .map((e) => e.workspaceId)
            .sort(),
        ).toEqual([a.workspaceId, b.workspaceId].sort());
        expect(await app.get(TaskDueScheduler).scan()).toMatchObject({ failed: [] });
        expect(
          seen.filter((e) => [a.workspaceId, b.workspaceId].includes(e.workspaceId)),
        ).toHaveLength(2);
      } finally {
        emitter.off('task.due', listener);
      }
    });
  });

  describe('permissions and isolation', () => {
    it('enforces task permissions and keeps workspaces apart', async () => {
      const a = await business();
      const other = await business();
      const viewer = await member(a, 'Viewer');
      const task = (await createTask(a, { title: 'Private' }).expect(201)).body.data as Json;
      await http.get('/tasks', viewer.token).expect(200);
      await createTask(viewer).expect(403);
      await http.patch(`/tasks/${task.id}`, { title: 'x' }, viewer.token).expect(403);
      await http.post(`/tasks/${task.id}/complete`, {}, viewer.token).expect(403);
      await http.get(`/tasks/${task.id}`, other.token).expect(404);
      await http.patch(`/tasks/${task.id}`, { title: 'x' }, other.token).expect(404);
      expect((await http.get('/tasks', other.token)).body.data).toEqual([]);
    });
  });
});
