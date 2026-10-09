import { createHmac } from 'node:crypto';
import { ClsService } from 'nestjs-cls';
import request from 'supertest';
import type { RequestContext } from '../src/common/context/request-context';
import { DomainEventBus } from '../src/common/events/domain-event-bus';
import { TasksService } from '../src/modules/crm/tasks.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

const APP_SECRET = 'notify-secret';

describe('Notifications', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp({ META_APP_SECRET: APP_SECRET });
    http = api(t.app);
  }, 90_000);
  afterAll(() => t.close());

  const call = (method: 'get' | 'post' | 'patch', token: string, path: string, body?: object) => {
    const agent = request(t.app.getHttpServer());
    const req = agent[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', `10.77.${(++n >> 8) & 255}.${n & 255}`);
    return body ? req.send(body) : req;
  };
  const deliver = (account: string, from: string, id: string, body: string) => {
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'w',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '1', phone_number_id: account },
                contacts: [{ profile: { name: 'Sana Malik' }, wa_id: from }],
                messages: [
                  {
                    from,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    id,
                    type: 'text',
                    text: { body },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    return request(t.app.getHttpServer())
      .post('/api/v1/webhooks/whatsapp')
      .set('X-Forwarded-For', `10.76.${(++n >> 8) & 255}.${n & 255}`)
      .set('Content-Type', 'application/json')
      .set(
        'X-Hub-Signature-256',
        `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`,
      )
      .send(raw)
      .expect(200);
  };

  async function setup(label: string, account: string) {
    const email = `owner@${label}.test`;
    await t.app.get(TenantsService).createWorkspace({
      name: label,
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      currency: 'PKR',
      country: 'PK',
    });
    const owner = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const workspaceId = (await t.db.prisma.workspace.findFirstOrThrow({ where: { name: label } }))
      .id;
    await http
      .post(
        '/integrations',
        { provider: 'WHATSAPP', values: { phoneNumberId: account, accessToken: 'tok' } },
        owner,
      )
      .expect(201);
    const roles = (await http.get('/roles', owner)).body.data as Json[];
    const member = async (role: string) => {
      const memberEmail = `${role.toLowerCase().replace(/\W/g, '')}@${label}.test`;
      const invite = await http
        .post(
          '/users/invite',
          { email: memberEmail, roleIds: [(roles.find((r) => r.name === role) as Json).id] },
          owner,
        )
        .expect(201);
      await http
        .post('/auth/invite/accept', {
          token: invite.body.data.token,
          password: 'member-password-1',
          firstName: role,
          lastName: 'U',
        })
        .expect(200);
      const token = (
        await http
          .post('/auth/login', { email: memberEmail, password: 'member-password-1' })
          .expect(200)
      ).body.data.accessToken as string;
      const user = await t.db.prisma.user.findFirstOrThrow({ where: { email: memberEmail } });
      return { token, userId: user.id };
    };
    const ownerUser = await t.db.prisma.user.findFirstOrThrow({ where: { email } });
    return {
      workspaceId,
      owner: { token: owner, userId: ownerUser.id },
      sales: await member('Salesperson'),
      manager: await member('Manager'),
      stock: await member('Inventory Staff'),
    };
  }
  const mine = async (token: string) =>
    (await call('get', token, '/notifications').expect(200)).body.data as Json[];
  const inWorkspace = <T>(workspaceId: string, fn: () => Promise<T>) =>
    t.app.get<ClsService<RequestContext>>(ClsService).runWith({ workspaceId }, fn);

  describe('who is told what', () => {
    let w: Awaited<ReturnType<typeof setup>>;
    beforeAll(async () => {
      w = await setup('notify-main', '5550101');
    });

    it('tells a salesperson when a lead is assigned to them, but not about their own doing', async () => {
      const lead = (
        await call('post', w.manager.token, '/leads', {
          fullName: 'Sana Malik',
          phone: '+923001110001',
          interest: 'corner sofa',
        }).expect(201)
      ).body.data as Json;
      expect(await mine(w.sales.token)).toHaveLength(0);
      await call('post', w.manager.token, `/leads/${lead.id}/assign`, {
        assignedToId: w.sales.userId,
      }).expect(200);
      const list = await mine(w.sales.token);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        type: 'lead.assigned',
        title: 'Lead assigned to you: Sana Malik',
        body: 'corner sofa',
        href: `/leads/${lead.id}`,
        read: false,
      });
      // the person who assigned it is not told
      expect(await mine(w.manager.token)).toHaveLength(0);
      // assigning a lead to yourself tells nobody
      const own = (
        await call('post', w.sales.token, '/leads', {
          fullName: 'My Own Lead',
          phone: '+923001110002',
        }).expect(201)
      ).body.data as Json;
      // a manager taking a lead for themselves is not told about it
      await call('post', w.manager.token, `/leads/${own.id}/assign`, {
        assignedToId: w.manager.userId,
      }).expect(200);
      expect(
        (await mine(w.manager.token)).filter((x) => x.title.includes('My Own Lead')),
      ).toHaveLength(0);
    });

    it('tells the assignee of a message, once for a busy chat, and the people who hand out conversations when a new one begins', async () => {
      await deliver('5550101', '923001110010', 'wamid.n-1', 'Hello, I need a bed');
      // nobody has the conversation yet: managers (who may assign) hear of it once; the salesperson does not
      expect(
        (await mine(w.manager.token)).filter((x) => x.type === 'conversation.message'),
      ).toHaveLength(1);
      expect(
        (await mine(w.owner.token)).filter((x) => x.type === 'conversation.message'),
      ).toHaveLength(1);
      expect(
        (await mine(w.sales.token)).filter((x) => x.type === 'conversation.message'),
      ).toHaveLength(0);
      await deliver('5550101', '923001110010', 'wamid.n-2', 'Are you there?');
      expect(
        (await mine(w.manager.token)).filter((x) => x.type === 'conversation.message'),
      ).toHaveLength(1); // the second message to an unassigned chat tells nobody new

      const conversation = await t.db.prisma.conversation.findFirstOrThrow({
        where: { workspaceId: w.workspaceId, externalContactId: '923001110010' },
      });
      await call('patch', w.manager.token, `/conversations/${conversation.id}`, {
        assignedToId: w.sales.userId,
      }).expect(200);
      await deliver('5550101', '923001110010', 'wamid.n-3', 'What is the price?');
      await deliver('5550101', '923001110010', 'wamid.n-4', 'And the delivery time?');
      const messages = (await mine(w.sales.token)).filter((x) => x.type === 'conversation.message');
      expect(messages).toHaveLength(1); // coalesced: one line, showing the latest
      expect(messages[0]).toMatchObject({
        title: 'New message from Sana Malik',
        body: 'And the delivery time?',
        href: `/conversations?open=${conversation.id}`,
      });
      // once read, the next message is a new notification
      await call('post', w.sales.token, `/notifications/${messages[0]!.id}/read`).expect(200);
      await deliver('5550101', '923001110010', 'wamid.n-5', 'Hello?');
      expect(
        (await mine(w.sales.token)).filter((x) => x.type === 'conversation.message'),
      ).toHaveLength(2);
    });

    it('tells the assignee a task is due, and everyone who sees all tasks when it has no assignee', async () => {
      const tasks = t.app.get(TasksService);
      const past = new Date(Date.now() - 3_600_000).toISOString();
      await call('post', w.manager.token, '/tasks', {
        type: 'CALL',
        title: 'Call Sana about the quote',
        dueAt: past,
        assignedToId: w.sales.userId,
      }).expect(201);
      await call('post', w.manager.token, '/tasks', {
        type: 'TODO',
        title: 'Reorder foam',
        dueAt: past,
        assignedToId: null,
      }).expect(201);
      await inWorkspace(w.workspaceId, () => tasks.publishDue(w.workspaceId));
      const salesTasks = (await mine(w.sales.token)).filter((x) => x.type === 'task.due');
      expect(salesTasks.map((x) => x.title)).toEqual(['Task due: Call Sana about the quote']);
      const managerTasks = (await mine(w.manager.token)).filter((x) => x.type === 'task.due');
      expect(managerTasks.map((x) => x.title)).toContain('Task due: Reorder foam');
      expect(managerTasks.map((x) => x.title)).not.toContain('Task due: Call Sana about the quote');
    });

    it('tells stock staff about low stock, AI escalations go to the assignee, and integration problems to those who manage them', async () => {
      const product = (
        await call('post', w.owner.token, '/catalog/products', {
          type: 'STOCKABLE',
          code: 'FOAM',
          name: 'Foam block',
          basePrice: '500',
          variants: [{ sku: 'FOAM-1' }],
        }).expect(201)
      ).body.data as Json;
      const location = await t.db.prisma.inventoryLocation.findFirstOrThrow({
        where: { workspaceId: w.workspaceId },
      });
      const bus = t.app.get(DomainEventBus);
      await bus.publish('stock.low', {
        workspaceId: w.workspaceId,
        variantId: product.variants[0].id,
        locationId: location.id,
        actorUserId: null,
      });
      const stock = (await mine(w.stock.token)).filter((x) => x.type === 'stock.low');
      expect(stock).toHaveLength(1);
      expect(stock[0]).toMatchObject({
        title: 'Low stock: Foam block (FOAM-1)',
        href: '/inventory',
      });
      expect((await mine(w.sales.token)).filter((x) => x.type === 'stock.low')).toHaveLength(0);

      const conversation = await t.db.prisma.conversation.findFirstOrThrow({
        where: { workspaceId: w.workspaceId, externalContactId: '923001110010' },
      });
      await t.db.prisma.conversation.update({
        where: { id: conversation.id },
        data: { needsHuman: true, needsHumanReason: 'The customer used "refund".' },
      });
      await bus.publish('ai.escalated', {
        workspaceId: w.workspaceId,
        conversationId: conversation.id,
        actorUserId: null,
      });
      const escalations = (await mine(w.sales.token)).filter((x) => x.type === 'ai.escalated');
      expect(escalations).toHaveLength(1);
      expect(escalations[0]).toMatchObject({
        body: 'The customer used "refund".',
        href: `/conversations?open=${conversation.id}`,
      });
      expect((await mine(w.stock.token)).filter((x) => x.type === 'ai.escalated')).toHaveLength(0);

      const connection = await t.db.prisma.integrationConnection.findFirstOrThrow({
        where: { workspaceId: w.workspaceId },
      });
      await t.db.prisma.integrationConnection.update({
        where: { id: connection.id },
        data: { lastError: 'AUTH_FAILED' },
      });
      await bus.publish('integration.failed', {
        workspaceId: w.workspaceId,
        connectionId: connection.id,
        actorUserId: null,
      });
      const problems = (await mine(w.owner.token)).filter((x) => x.type === 'integration.failed');
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ body: 'AUTH_FAILED', href: '/integrations' });
      expect(
        (await mine(w.sales.token)).filter((x) => x.type === 'integration.failed'),
      ).toHaveLength(0);
    });
  });

  describe('the endpoints', () => {
    let w: Awaited<ReturnType<typeof setup>>;
    let other: Awaited<ReturnType<typeof setup>>;
    beforeAll(async () => {
      w = await setup('notify-api', '5550102');
      other = await setup('notify-other', '5550103');
      const lead = async (name: string, phone: string) =>
        (
          (await call('post', w.manager.token, '/leads', { fullName: name, phone }).expect(201))
            .body.data as Json
        ).id as string;
      for (const [i, name] of ['Anna', 'Bela', 'Cyrus'].entries()) {
        await call(
          'post',
          w.manager.token,
          `/leads/${await lead(name, `+92300222000${i}`)}/assign`,
          { assignedToId: w.sales.userId },
        ).expect(200);
      }
    });

    it('lists newest first, filters unread, pages, counts, and marks read', async () => {
      const all = await mine(w.sales.token);
      expect(all.map((x) => x.title)).toEqual([
        'Lead assigned to you: Cyrus',
        'Lead assigned to you: Bela',
        'Lead assigned to you: Anna',
      ]);
      expect(
        (await call('get', w.sales.token, '/notifications/unread-count').expect(200)).body.data,
      ).toEqual({ count: 3 });

      const page1 = (await call('get', w.sales.token, '/notifications?limit=2').expect(200)).body;
      expect(page1.data).toHaveLength(2);
      const page2 = (
        await call(
          'get',
          w.sales.token,
          `/notifications?limit=2&cursor=${encodeURIComponent(page1.meta.nextCursor)}`,
        ).expect(200)
      ).body;
      expect(page2.data.map((x: Json) => x.title)).toEqual(['Lead assigned to you: Anna']);

      await call('post', w.sales.token, `/notifications/${all[0]!.id}/read`).expect(200);
      expect(
        (await call('get', w.sales.token, '/notifications/unread-count').expect(200)).body.data,
      ).toEqual({ count: 2 });
      expect(
        (
          (await call('get', w.sales.token, '/notifications?unread=true').expect(200)).body
            .data as Json[]
        ).map((x) => x.title),
      ).toEqual(['Lead assigned to you: Bela', 'Lead assigned to you: Anna']);
      await call('post', w.sales.token, `/notifications/${all[0]!.id}/read`).expect(200); // reading twice changes nothing
      expect(
        (await call('post', w.sales.token, '/notifications/read-all').expect(200)).body.data,
      ).toEqual({ marked: 2 });
      expect(
        (await call('get', w.sales.token, '/notifications/unread-count').expect(200)).body.data,
      ).toEqual({ count: 0 });
    });

    it("keeps everyone's notifications to themselves", async () => {
      const theirs = await mine(w.sales.token);
      await call('post', w.manager.token, `/notifications/${theirs[0]!.id}/read`).expect(404);
      await call('post', other.owner.token, `/notifications/${theirs[0]!.id}/read`).expect(404);
      expect(await mine(w.manager.token)).toHaveLength(0);
      expect(await mine(other.sales.token)).toHaveLength(0);
      expect(
        (await call('post', w.manager.token, '/notifications/read-all').expect(200)).body.data,
      ).toEqual({ marked: 0 });
      expect(
        (await call('get', w.sales.token, '/notifications/unread-count').expect(200)).body.data,
      ).toEqual({ count: 0 }); // still mine, still read
    });

    it('needs a signed-in user', async () => {
      await request(t.app.getHttpServer())
        .get('/api/v1/notifications')
        .set('X-Forwarded-For', '10.70.0.1')
        .expect(401);
      await request(t.app.getHttpServer())
        .get('/api/v1/notifications/unread-count')
        .set('X-Forwarded-For', '10.70.0.2')
        .expect(401);
    });
  });
});
