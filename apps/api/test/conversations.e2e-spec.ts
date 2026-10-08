import { createHmac } from 'node:crypto';
import request from 'supertest';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../src/common/context/request-context';
import { ProviderHttpError } from '../src/modules/integrations/adapter-runner';
import { WhatsAppAdapter } from '../src/modules/channels/whatsapp/whatsapp.adapter';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { FilesService } from '../src/modules/files/files.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

const APP_SECRET = 'meta-app-secret';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

const textIn = (account: string, from: string, id: string, ts: number, body: string): Json => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '923001234567', phone_number_id: account },
            contacts: [{ profile: { name: 'Sana Malik' }, wa_id: from }],
            messages: [{ from, timestamp: String(ts), id, type: 'text', text: { body } }],
          },
        },
      ],
    },
  ],
});

describe('Conversations and outbound messaging', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;
  const sendMessage = jest.fn();

  beforeAll(async () => {
    t = await createTestApp({ META_APP_SECRET: APP_SECRET });
    http = api(t.app);
  }, 90_000);
  afterAll(() => t.close());
  beforeEach(() => {
    sendMessage.mockReset();
    let i = 0;
    sendMessage.mockImplementation(async () => ({
      externalMessageId: `wamid.out-${++i}-${Date.now()}`,
    }));
    jest.spyOn(t.app.get(WhatsAppAdapter), 'sendMessage').mockImplementation(sendMessage);
  });
  afterEach(() => jest.restoreAllMocks());

  const ip = () => `10.70.${(++n >> 8) & 255}.${n & 255}`;
  const call = (
    method: 'get' | 'post' | 'patch',
    token: string,
    path: string,
    body?: object,
    key?: string,
  ) => {
    const agent = request(t.app.getHttpServer());
    const req = agent[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', ip());
    if (key) req.set('Idempotency-Key', key);
    return body ? req.send(body) : req;
  };

  const inbound = (
    account: string,
    from: string,
    id: string,
    body = 'Hello',
    ts = Math.floor(Date.now() / 1000),
  ) => {
    const raw = JSON.stringify(textIn(account, from, id, ts, body));
    return request(t.app.getHttpServer())
      .post('/api/v1/webhooks/whatsapp')
      .set('X-Forwarded-For', ip())
      .set('Content-Type', 'application/json')
      .set(
        'X-Hub-Signature-256',
        `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`,
      )
      .send(raw);
  };

  async function workspace(label: string, account: string) {
    const email = `owner@${label}.test`;
    await t.app.get(TenantsService).createWorkspace({
      name: label,
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      currency: 'PKR',
      country: 'PK',
    });
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const connection = (
      await http
        .post(
          '/integrations',
          { provider: 'WHATSAPP', values: { phoneNumberId: account, accessToken: 'tok-123456' } },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const row = await t.db.prisma.integrationConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    return { token, workspaceId: row.workspaceId, email };
  }

  async function member(ws: { token: string; email: string }, role: string) {
    const roles = (await http.get('/roles', ws.token)).body.data as Json[];
    const email = `${role.toLowerCase().replace(/\W/g, '')}@${ws.email.split('@')[1]}`;
    const invite = await http
      .post(
        '/users/invite',
        { email, roleIds: [(roles.find((r) => r.name === role) as Json).id] },
        ws.token,
      )
      .expect(201);
    await http
      .post('/auth/invite/accept', {
        token: invite.body.data.token,
        password: 'member-password-1',
        firstName: role,
        lastName: 'User',
      })
      .expect(200);
    const login = (
      await http.post('/auth/login', { email, password: 'member-password-1' }).expect(200)
    ).body.data;
    return {
      token: login.accessToken as string,
      userId: (login.user?.id ?? null) as string | null,
    };
  }

  /** Runs server code the way a request of this workspace would. */
  const inWorkspace = <T>(workspaceId: string, fn: () => Promise<T>): Promise<T> =>
    t.app.get<ClsService<RequestContext>>(ClsService).runWith({ workspaceId }, fn);

  const conversationOf = (workspaceId: string, contact: string) =>
    t.db.prisma.conversation.findFirstOrThrow({
      where: { workspaceId, externalContactId: contact },
    });

  describe('reading', () => {
    let ws: Awaited<ReturnType<typeof workspace>>;
    let sales: Awaited<ReturnType<typeof member>>;
    let manager: Awaited<ReturnType<typeof member>>;

    beforeAll(async () => {
      ws = await workspace('conv-read', '6660001');
      sales = await member(ws, 'Salesperson');
      manager = await member(ws, 'Manager');
      await inbound('6660001', '923001110001', 'wamid.r-1', 'First customer').expect(200);
      await inbound('6660001', '923001110002', 'wamid.r-2', 'Second customer').expect(200);
    });

    it('lists with the last message and unread count; a salesperson sees only what is assigned to them', async () => {
      const all = (await call('get', ws.token, '/conversations').expect(200)).body;
      expect(all.data).toHaveLength(2);
      expect(all.data[0]).toMatchObject({
        unreadCount: 1,
        status: 'OPEN',
        channelType: 'WHATSAPP',
        canSendFreeform: true,
        optedOut: false,
        lastMessageDirection: 'INBOUND',
      });
      expect(all.data.map((c: Json) => c.lastMessagePreview).sort()).toEqual([
        'First customer',
        'Second customer',
      ]);

      expect((await call('get', sales.token, '/conversations').expect(200)).body.data).toHaveLength(
        0,
      );
      const first = await conversationOf(ws.workspaceId, '923001110001');
      await call('get', sales.token, `/conversations/${first.id}`).expect(404);
      const salesUser = await t.db.prisma.user.findFirstOrThrow({
        where: { email: 'salesperson@conv-read.test' },
      });
      await call('patch', ws.token, `/conversations/${first.id}`, {
        assignedToId: salesUser.id,
      }).expect(200);
      const mine = (await call('get', sales.token, '/conversations').expect(200)).body
        .data as Json[];
      expect(mine.map((c) => c.id)).toEqual([first.id]);
      await call('get', sales.token, `/conversations/${first.id}`).expect(200);
      // the manager can see everything
      expect(
        (await call('get', manager.token, '/conversations').expect(200)).body.data,
      ).toHaveLength(2);
    });

    it('filters by status, assignment, unread and needs-human', async () => {
      const first = await conversationOf(ws.workspaceId, '923001110001');
      expect(
        (await call('get', ws.token, '/conversations?assigned=none').expect(200)).body.data,
      ).toHaveLength(1);
      expect(
        (await call('get', ws.token, `/conversations?assigned=${first.assignedToId}`).expect(200))
          .body.data,
      ).toHaveLength(1);
      expect(
        (await call('get', ws.token, '/conversations?status=CLOSED').expect(200)).body.data,
      ).toHaveLength(0);
      expect(
        (await call('get', ws.token, '/conversations?unread=true').expect(200)).body.data,
      ).toHaveLength(2);
      expect(
        (await call('get', ws.token, '/conversations?needsHuman=true').expect(200)).body.data,
      ).toHaveLength(0);
      expect(
        (await call('get', ws.token, '/conversations?q=sana').expect(200)).body.data,
      ).toHaveLength(2);
      await call('get', ws.token, '/conversations?status=NOPE').expect(400);
    });

    it('pages messages newest first and marks a conversation read', async () => {
      for (let i = 0; i < 3; i += 1)
        await inbound(
          '6660001',
          '923001110001',
          `wamid.r-p${i}`,
          `more ${i}`,
          1_800_000_000 + i,
        ).expect(200);
      const first = await conversationOf(ws.workspaceId, '923001110001');
      const page1 = (
        await call('get', ws.token, `/conversations/${first.id}/messages?limit=2`).expect(200)
      ).body;
      expect(page1.data).toHaveLength(2);
      expect(page1.meta.nextCursor).toBeTruthy();
      const page2 = (
        await call(
          'get',
          ws.token,
          `/conversations/${first.id}/messages?limit=2&cursor=${encodeURIComponent(page1.meta.nextCursor)}`,
        ).expect(200)
      ).body;
      expect(page2.data).toHaveLength(2);
      expect(page2.data.map((m: Json) => m.id)).not.toEqual(
        expect.arrayContaining(page1.data.map((m: Json) => m.id)),
      );

      expect(
        (await call('get', ws.token, '/conversations/unread-count').expect(200)).body.data
          .conversations,
      ).toBe(2);
      const read = (await call('post', ws.token, `/conversations/${first.id}/read`).expect(200))
        .body.data;
      expect(read.unreadCount).toBe(0);
      expect(
        (await call('get', ws.token, '/conversations/unread-count').expect(200)).body.data
          .conversations,
      ).toBe(1);
    });

    it('each change needs its own permission and is audited', async () => {
      const second = await conversationOf(ws.workspaceId, '923001110002');
      const salesFirst = await conversationOf(ws.workspaceId, '923001110001');
      // a salesperson may reply (take over) but not assign, re-enable automation or switch AI
      await call('patch', sales.token, `/conversations/${salesFirst.id}`, {
        assignedToId: null,
      }).expect(403);
      await call('patch', sales.token, `/conversations/${salesFirst.id}`, {
        automationActive: true,
      }).expect(403);
      await call('patch', sales.token, `/conversations/${salesFirst.id}`, {
        aiEnabled: false,
      }).expect(403);
      await call('patch', sales.token, `/conversations/${salesFirst.id}`, {
        status: 'PENDING',
      }).expect(200);
      await call('patch', ws.token, `/conversations/${second.id}`, {
        aiEnabled: false,
        automationActive: true,
      }).expect(200);
      await call('patch', ws.token, `/conversations/${second.id}`, {
        assignedToId: 'not-a-member',
      }).expect(400);
      const audit = await t.db.prisma.auditEvent.findMany({
        where: { workspaceId: ws.workspaceId, action: 'conversation.update', entityId: second.id },
      });
      expect(audit.length).toBe(1);
    });

    it('links a conversation to an existing customer', async () => {
      const second = await conversationOf(ws.workspaceId, '923001110002');
      const customer = (
        await call('post', ws.token, '/customers', {
          fullName: 'Known Customer',
          phones: ['+923001110002'],
        }).expect(201)
      ).body.data as Json;
      const linked = (
        await call('patch', ws.token, `/conversations/${second.id}`, {
          customerId: customer.id,
        }).expect(200)
      ).body.data;
      expect(linked).toMatchObject({ customerId: customer.id, customerName: 'Known Customer' });
      await call('patch', ws.token, `/conversations/${second.id}`, { customerId: 'nope' }).expect(
        400,
      );
    });

    it('is found by contact name or number in global search, within what the person may see', async () => {
      const ours = (await call('get', ws.token, '/search?q=sana').expect(200)).body.data
        .groups as Json[];
      expect(ours.find((g) => g.type === 'CONVERSATION')?.hits).toHaveLength(2);
      const byPhone = (await call('get', ws.token, '/search?q=3001110001').expect(200)).body.data
        .groups as Json[];
      expect(byPhone.find((g) => g.type === 'CONVERSATION')?.hits[0].href).toMatch(
        /^\/conversations\?open=/,
      );
      // the salesperson sees only the conversation assigned to them
      const mine = (await call('get', sales.token, '/search?q=sana').expect(200)).body.data
        .groups as Json[];
      expect(mine.find((g) => g.type === 'CONVERSATION')?.hits).toHaveLength(1);
    });

    it('links a conversation to a lead', async () => {
      const second = await conversationOf(ws.workspaceId, '923001110002');
      const lead = (
        await call('post', ws.token, '/leads', {
          fullName: 'Another Lead',
          phone: '+923007770001',
        }).expect(201)
      ).body.data as Json;
      expect(
        (
          await call('patch', ws.token, `/conversations/${second.id}`, { leadId: lead.id }).expect(
            200,
          )
        ).body.data,
      ).toMatchObject({ leadId: lead.id, leadName: 'Another Lead' });
      await call('patch', ws.token, `/conversations/${second.id}`, { leadId: 'nope' }).expect(400);
    });

    it("another workspace's conversation is a 404", async () => {
      const other = await workspace('conv-other', '6660002');
      const first = await conversationOf(ws.workspaceId, '923001110001');
      await call('get', other.token, `/conversations/${first.id}`).expect(404);
      await call(
        'post',
        other.token,
        `/conversations/${first.id}/messages`,
        { body: 'hi' },
        'k-iso',
      ).expect(404);
    });
  });

  describe('sending', () => {
    let ws: Awaited<ReturnType<typeof workspace>>;
    let sales: Awaited<ReturnType<typeof member>>;
    let conversationId: string;
    let key = 0;
    const send = (body: object, token = ws.token, id = conversationId) =>
      call('post', token, `/conversations/${id}/messages`, body, `send-${++key}`);

    beforeAll(async () => {
      ws = await workspace('conv-send', '6660010');
      sales = await member(ws, 'Salesperson');
      await inbound('6660010', '923001230010', 'wamid.s-1', 'I want a sofa').expect(200);
      conversationId = (await conversationOf(ws.workspaceId, '923001230010')).id;
    });

    it('sends a text reply: stored, handed to the provider, marked sent, and the conversation is taken over', async () => {
      await t.db.prisma.conversation.update({
        where: { id: conversationId },
        data: { automationActive: true, needsHuman: true, needsHumanReason: 'asked for a person' },
      });
      const res = await send({ body: 'Thank you, we can make it in 3 weeks' }).expect(201);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        direction: 'OUTBOUND',
        senderType: 'STAFF',
        type: 'TEXT',
        body: 'Thank you, we can make it in 3 weeks',
        status: 'SENT',
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);
      const [secrets, to, content] = sendMessage.mock.calls[0] as [Json, string, Json];
      expect(secrets.accessToken).toBe('tok-123456');
      expect(to).toBe('923001230010');
      expect(content).toEqual({ kind: 'text', body: 'Thank you, we can make it in 3 weeks' });
      const row = await t.db.prisma.message.findUniqueOrThrow({
        where: { id: res.body.data[0].id },
      });
      expect(row.externalId).toMatch(/^wamid\.out-/);
      // 73.1 — a staff reply turns automation off for that conversation
      expect(
        await t.db.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } }),
      ).toMatchObject({ automationActive: false, needsHuman: false, needsHumanReason: null });
    });

    it('a repeated request with the same key sends once', async () => {
      const first = await call(
        'post',
        ws.token,
        `/conversations/${conversationId}/messages`,
        { body: 'Once only' },
        'same-key',
      ).expect(201);
      const again = await call(
        'post',
        ws.token,
        `/conversations/${conversationId}/messages`,
        { body: 'Once only' },
        'same-key',
      ).expect(201);
      expect(again.body.data[0].id).toBe(first.body.data[0].id);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      await call('post', ws.token, `/conversations/${conversationId}/messages`, {
        body: 'x',
      }).expect(400); // the key is required
    });

    it('rejects an empty message, a template with text, and a conversation the person cannot see', async () => {
      await send({}).expect(400);
      await send({ body: '   ' }).expect(400);
      await send({ body: 'x', templateId: 'abc' }).expect(400);
      await send({ body: 'hi' }, sales.token).expect(404); // not assigned to the salesperson
    });

    it('73.1 — outside the free-form window only an approved provider template is accepted', async () => {
      await t.db.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) },
      });
      const text = await send({ body: 'Are you still interested?' }).expect(422);
      expect(text.body.code).toBe('FREEFORM_WINDOW_CLOSED');
      const quick = (
        await call('post', ws.token, '/templates', {
          name: 'Thanks',
          kind: 'QUICK_REPLY',
          body: 'Thanks {{customer_name}}!',
        }).expect(201)
      ).body.data;
      expect((await send({ templateId: quick.id }).expect(422)).body.code).toBe(
        'FREEFORM_WINDOW_CLOSED',
      );
      const files = t.app.get(FilesService);
      const stored = await inWorkspace(ws.workspaceId, () =>
        files.storeSystemFile(ws.workspaceId, { buffer: PDF, name: 'catalogue.pdf' }),
      );
      expect(
        (await send({ attachments: [{ type: 'FILE', id: stored!.id }] }).expect(422)).body.code,
      ).toBe('FREEFORM_WINDOW_CLOSED');
      expect(sendMessage).not.toHaveBeenCalled();

      const pending = (
        await call('post', ws.token, '/templates', {
          name: 'Follow up',
          kind: 'PROVIDER',
          providerName: 'follow_up',
          language: 'en',
          body: 'Hello {{1}}, are you still interested in {{2}}?',
        }).expect(201)
      ).body.data;
      expect(pending.providerStatus).toBe('PENDING');
      expect(
        (await send({ templateId: pending.id, parameters: ['Sana', 'the sofa'] }).expect(400)).body
          .code,
      ).toBe('VALIDATION_FAILED'); // not approved yet
      await call('patch', ws.token, `/templates/${pending.id}`, {
        providerStatus: 'APPROVED',
      }).expect(200);
      await send({ templateId: pending.id, parameters: ['Sana'] }).expect(422); // {{2}} has no value
      const ok = await send({ templateId: pending.id, parameters: ['Sana', 'the sofa'] }).expect(
        201,
      );
      expect(ok.body.data[0]).toMatchObject({
        type: 'TEMPLATE',
        body: 'Hello Sana, are you still interested in the sofa?',
        status: 'SENT',
      });
      expect(sendMessage.mock.calls[0]?.[2]).toEqual({
        kind: 'template',
        name: 'follow_up',
        language: 'en',
        parameters: ['Sana', 'the sofa'],
      });
      // the customer writes again: the window is open
      await inbound('6660010', '923001230010', 'wamid.s-2', 'Yes!').expect(200);
      await send({ body: 'Great, calling you now' }).expect(201);
    });

    it('resolves template variables and refuses to send with one missing', async () => {
      await call('patch', ws.token, '/settings', {
        business: { legalName: 'Acme Furniture' },
      }).expect(200);
      const t1 = (
        await call('post', ws.token, '/templates', {
          name: 'Balance',
          kind: 'MESSAGE',
          body: 'Dear {{customer_name}}, order {{order_number}} total {{order_total}}, balance {{balance_due}} - {{business_name}}',
        }).expect(201)
      ).body.data;
      expect(t1.variables).toEqual([
        'customer_name',
        'order_number',
        'order_total',
        'balance_due',
        'business_name',
      ]);
      const missing = await send({ templateId: t1.id }).expect(422);
      expect(missing.body).toMatchObject({ code: 'UNRESOLVED_TEMPLATE_VARIABLE' });
      expect(JSON.stringify(missing.body)).toContain('order_number');
      expect(sendMessage).not.toHaveBeenCalled();

      const product = (
        await call('post', ws.token, '/catalog/products', {
          type: 'NON_STOCKABLE',
          code: 'S',
          name: 'Sofa',
          basePrice: '1000.00',
          variants: [{ sku: 'S-A' }],
        }).expect(201)
      ).body.data as Json;
      const customer = (
        await call('post', ws.token, '/customers', {
          fullName: 'Sana Malik',
          phones: ['+923001230010'],
        }).expect(201)
      ).body.data as Json;
      const order = (
        await call(
          'post',
          ws.token,
          '/orders',
          {
            customerId: customer.id,
            lines: [{ variantId: product.variants[0].id, quantity: '2' }],
          },
          'ord-1',
        ).expect(201)
      ).body.data as Json;
      await call('patch', ws.token, `/conversations/${conversationId}`, {
        customerId: customer.id,
      }).expect(200);
      const sent = await send({ templateId: t1.id, orderId: order.id }).expect(201);
      expect(sent.body.data[0].body).toMatch(
        /^Dear Sana Malik, order .+ total .*2,000.* balance .*2,000.* - /,
      );
      expect(sent.body.data[0].body).not.toContain('{{');
      await send({ templateId: t1.id, orderId: 'missing' }).expect(400);
    });

    it('the bank-details template resolves from the customer-facing accounts', async () => {
      const tpl = (
        await call('post', ws.token, '/templates', {
          name: 'Bank details',
          kind: 'BANK_DETAILS',
          body: 'Please pay to:\n{{bank_details}}',
        }).expect(201)
      ).body.data;
      expect((await send({ templateId: tpl.id }).expect(422)).body.code).toBe(
        'UNRESOLVED_TEMPLATE_VARIABLE',
      ); // no account is shown to customers yet
      await t.db.prisma.financialAccount.create({
        data: {
          workspaceId: ws.workspaceId,
          type: 'BANK',
          name: 'Meezan',
          bankName: 'Meezan Bank',
          accountTitle: 'Acme Furniture',
          accountNumber: 'PK00MEZN0001',
          showToCustomers: true,
        },
      });
      const sent = await send({ templateId: tpl.id }).expect(201);
      expect(sent.body.data[0].body).toContain('Account number: PK00MEZN0001');
    });

    it('validates templates: unknown variables, duplicates, permission', async () => {
      const bad = await call('post', ws.token, '/templates', {
        name: 'Bad',
        kind: 'MESSAGE',
        body: 'Hi {{nickname}}',
      }).expect(400);
      expect(JSON.stringify(bad.body.details)).toContain('nickname');
      await call('post', ws.token, '/templates', {
        name: 'Thanks',
        kind: 'QUICK_REPLY',
        body: 'again',
      }).expect(422);
      await call('post', ws.token, '/templates', { name: 'P', kind: 'PROVIDER', body: 'x' }).expect(
        400,
      );
      await call('post', sales.token, '/templates', {
        name: 'Mine',
        kind: 'QUICK_REPLY',
        body: 'x',
      }).expect(403);
      await call('get', sales.token, '/templates?kind=QUICK_REPLY').expect(403);
    });

    it('sends files and documents as separate messages, with the typed text as the first caption', async () => {
      jest
        .spyOn(t.app.get(DocumentsService), 'receiptPdf')
        .mockResolvedValue({ buffer: PDF, filename: 'REC-1.pdf' });
      const png = await (
        await import('sharp')
      )
        .default({ create: { width: 8, height: 8, channels: 3, background: '#33a' } })
        .png()
        .toBuffer();
      const image = await inWorkspace(ws.workspaceId, () =>
        t.app.get(FilesService).storeSystemFile(ws.workspaceId, { buffer: png, name: 'sofa.png' }),
      );
      const res = await send({
        body: 'Here you go',
        attachments: [
          { type: 'FILE', id: image!.id },
          { type: 'RECEIPT', id: 'rec-1' },
        ],
      }).expect(201);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.map((m: Json) => m.type)).toEqual(['IMAGE', 'DOCUMENT']);
      expect(res.body.data[0].attachments[0]).toMatchObject({
        mime: 'image/png',
        name: 'sofa.png',
      });
      const contents = sendMessage.mock.calls.map((c) => c[2] as Json);
      expect(contents[0]).toMatchObject({
        kind: 'media',
        mediaType: 'image',
        caption: 'Here you go',
      });
      expect(contents[0].link).toMatch(/^http/);
      expect(contents[1]).toMatchObject({
        kind: 'media',
        mediaType: 'document',
        filename: 'REC-1.pdf',
      });
      expect(contents[1].caption).toBeUndefined();
      await send({ attachments: [{ type: 'FILE', id: 'nope' }] }).expect(400);
    });

    it('a salesperson can reply on a conversation assigned to them and cannot attach a document that does not exist', async () => {
      const salesUser = await t.db.prisma.user.findFirstOrThrow({
        where: { email: 'salesperson@conv-send.test' },
      });
      await t.db.prisma.conversation.update({
        where: { id: conversationId },
        data: { assignedToId: salesUser.id },
      });
      // a document that does not exist is a 404, not a send
      await send({ attachments: [{ type: 'RECEIPT', id: 'rec-1' }] }, sales.token).expect(404);
      await send({ body: 'my own reply' }, sales.token).expect(201);
    });

    it('does not send template messages to a contact who opted out, but staff can still write', async () => {
      await inbound('6660010', '923001230010', 'wamid.s-stop', 'STOP').expect(200);
      const tpl = (
        await call('post', ws.token, '/templates', {
          name: 'Promo',
          kind: 'MESSAGE',
          body: 'Sale at {{business_name}}',
        }).expect(201)
      ).body.data;
      const refused = await send({ templateId: tpl.id }).expect(422);
      expect(refused.body.code).toBe('CONTACT_OPTED_OUT');
      expect(
        (await call('get', ws.token, `/conversations/${conversationId}`).expect(200)).body.data
          .optedOut,
      ).toBe(true);
      await send({ body: 'Understood, we will not message you again.' }).expect(201);
    });

    it('syncs the provider templates and their approval status', async () => {
      jest.spyOn(t.app.get(WhatsAppAdapter), 'listTemplates').mockResolvedValue([
        {
          name: 'order_ready',
          language: 'en',
          status: 'APPROVED',
          body: 'Your order {{1}} is ready',
        },
        {
          name: 'order_ready',
          language: 'ur',
          status: 'PENDING',
          body: 'آپ کا آرڈر {{1}} تیار ہے',
        },
      ]);
      const synced = (await call('post', ws.token, '/templates/sync').expect(200)).body
        .data as Json[];
      expect(synced.map((x) => [x.providerName, x.language, x.providerStatus])).toEqual([
        ['order_ready', 'en', 'APPROVED'],
        ['order_ready', 'ur', 'PENDING'],
      ]);
      await call('post', ws.token, '/templates/sync').expect(200); // running it again changes nothing
      expect(
        await t.db.prisma.messageTemplate.count({
          where: { workspaceId: ws.workspaceId, kind: 'PROVIDER', providerName: 'order_ready' },
        }),
      ).toBe(2);
    });
  });

  describe('delivery problems', () => {
    it('marks a message failed with a reason after the provider keeps refusing it', async () => {
      const ws = await workspace('conv-fail', '6660020');
      await inbound('6660020', '923001230020', 'wamid.f-1', 'hello').expect(200);
      const conversation = await conversationOf(ws.workspaceId, '923001230020');
      sendMessage.mockReset();
      sendMessage.mockRejectedValue(new ProviderHttpError(500, 'provider is down'));
      const res = await call(
        'post',
        ws.token,
        `/conversations/${conversation.id}/messages`,
        { body: 'Hi' },
        'fail-1',
      ).expect(201);
      expect(res.body.data[0].status).toBe('FAILED'); // queued, tried three times, given up
      const stored = await t.db.prisma.message.findUniqueOrThrow({
        where: { id: res.body.data[0].id },
      });
      expect(stored.status).toBe('FAILED');
      expect(stored.failureReason).toBeTruthy();
      expect(stored.failureReason).not.toContain('provider is down'); // a code, not the provider's words
      expect(stored.externalId).toBeNull();
      // the conversation still shows the failed message to the person who sent it
      const messages = (
        await call('get', ws.token, `/conversations/${conversation.id}/messages`).expect(200)
      ).body.data as Json[];
      expect(messages[0]).toMatchObject({ status: 'FAILED', direction: 'OUTBOUND' });
    });

    it('a disconnected channel cannot be written to', async () => {
      const ws = await workspace('conv-disc', '6660030');
      await inbound('6660030', '923001230030', 'wamid.d-1', 'hello').expect(200);
      const conversation = await conversationOf(ws.workspaceId, '923001230030');
      const connection = await t.db.prisma.integrationConnection.findFirstOrThrow({
        where: { workspaceId: ws.workspaceId },
      });
      await call('post', ws.token, `/integrations/${connection.id}/disconnect`, {}).expect(200);
      await call(
        'post',
        ws.token,
        `/conversations/${conversation.id}/messages`,
        { body: 'Hi' },
        'disc-1',
      ).expect(422);
    });

    it('applies a delivery report that arrives before the provider id is stored', async () => {
      const ws = await workspace('conv-race', '6660040');
      await inbound('6660040', '923001230040', 'wamid.x-1', 'hello').expect(200);
      const conversation = await conversationOf(ws.workspaceId, '923001230040');
      // the provider reports "read" for the reply while the send call is still in flight
      sendMessage.mockReset();
      sendMessage.mockImplementation(async () => {
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
                    metadata: { phone_number_id: '6660040' },
                    statuses: [
                      {
                        id: 'wamid.race-1',
                        status: 'read',
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        recipient_id: '923001230040',
                      },
                    ],
                  },
                },
              ],
            },
          ],
        });
        await request(t.app.getHttpServer())
          .post('/api/v1/webhooks/whatsapp')
          .set('X-Forwarded-For', ip())
          .set('Content-Type', 'application/json')
          .set(
            'X-Hub-Signature-256',
            `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`,
          )
          .send(raw)
          .expect(200);
        return { externalMessageId: 'wamid.race-1' };
      });
      const res = await call(
        'post',
        ws.token,
        `/conversations/${conversation.id}/messages`,
        { body: 'Hi' },
        'race-1',
      ).expect(201);
      expect(
        (await t.db.prisma.message.findUniqueOrThrow({ where: { id: res.body.data[0].id } }))
          .status,
      ).toBe('READ');
    });
  });
});
