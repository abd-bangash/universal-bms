import { createHmac } from 'node:crypto';
import * as fc from 'fast-check';
import request from 'supertest';
import { ClsService } from 'nestjs-cls';
import sharp from 'sharp';
import type { RequestContext } from '../src/common/context/request-context';
import { ChannelInboundService } from '../src/modules/channels/channel-inbound.service';
import { WhatsAppAdapter } from '../src/modules/channels/whatsapp/whatsapp.adapter';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

const APP_SECRET = 'meta-app-secret';
const VERIFY_TOKEN = 'verify-me';

const sign = (body: string, secret = APP_SECRET): string =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const envelope = (accountId: string, value: Json): Json => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '923001234567', phone_number_id: accountId },
            ...value,
          },
        },
      ],
    },
  ],
});

const textIn = (
  accountId: string,
  from: string,
  id: string,
  ts: number,
  body: string,
  name = 'Sana Malik',
) =>
  envelope(accountId, {
    contacts: [{ profile: { name }, wa_id: from }],
    messages: [{ from, timestamp: String(ts), id, type: 'text', text: { body } }],
  });

const imageIn = (accountId: string, from: string, id: string, ts: number) =>
  envelope(accountId, {
    contacts: [{ profile: { name: 'Sana Malik' }, wa_id: from }],
    messages: [
      {
        from,
        timestamp: String(ts),
        id,
        type: 'image',
        image: { id: `media-${id}`, mime_type: 'image/png' },
      },
    ],
  });

const statusOf = (accountId: string, id: string, status: string, ts: number, to: string) =>
  envelope(accountId, {
    statuses: [
      {
        id,
        status,
        timestamp: String(ts),
        recipient_id: to,
        ...(status === 'failed' ? { errors: [{ code: 131026, title: 'Undeliverable' }] } : {}),
      },
    ],
  });

describe('Webhook ingestion', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp({
      META_APP_SECRET: APP_SECRET,
      META_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    });
    http = api(t.app);
  }, 90_000);
  afterAll(() => t.close());

  /** A signed delivery from a fresh client address. */
  const deliver = (payload: Json, opts: { signature?: string | null } = {}) => {
    const body = JSON.stringify(payload);
    const req = request(t.app.getHttpServer())
      .post('/api/v1/webhooks/whatsapp')
      .set('X-Forwarded-For', `10.50.${(++n >> 8) & 255}.${n & 255}`)
      .set('Content-Type', 'application/json');
    if (opts.signature !== null) req.set('X-Hub-Signature-256', opts.signature ?? sign(body));
    return req.send(body);
  };

  /** A workspace with WhatsApp connected on the given phone number id. */
  async function workspace(label: string, accountId: string) {
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
          { provider: 'WHATSAPP', values: { phoneNumberId: accountId, accessToken: 'tok-123456' } },
          token,
        )
        .expect(201)
    ).body.data as Json;
    const row = await t.db.prisma.integrationConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    return { token, connectionId: connection.id as string, workspaceId: row.workspaceId };
  }

  const png = () =>
    sharp({ create: { width: 8, height: 8, channels: 3, background: '#a33' } })
      .png()
      .toBuffer();

  describe('verification and signatures (72.2)', () => {
    let ws: Awaited<ReturnType<typeof workspace>>;
    beforeAll(async () => {
      ws = await workspace('wh-sig', '5550001');
    });

    it('answers the provider challenge only with the right token', async () => {
      const ok = await http.get(
        `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`,
      );
      expect(ok.status).toBe(200);
      expect(ok.text).toBe('12345');
      await http
        .get('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1')
        .expect(403);
      await http.get('/webhooks/unknown-provider?hub.mode=subscribe').expect(404);
    });

    it('an invalid signature returns 401, is audited and stores nothing', async () => {
      const payload = textIn('5550001', '923331110001', 'wamid.sig-1', 1_741_600_000, 'hello');
      await deliver(payload, { signature: sign(JSON.stringify(payload), 'wrong-secret') }).expect(
        401,
      );
      await deliver(payload, { signature: null }).expect(401);
      await deliver(payload, { signature: 'sha256=zz' }).expect(401);
      expect(
        await t.db.prisma.webhookEvent.count({ where: { dedupeKey: 'wa:msg:wamid.sig-1' } }),
      ).toBe(0);
      expect(await t.db.prisma.message.count({ where: { workspaceId: ws.workspaceId } })).toBe(0);
      const audited = await t.db.prisma.auditEvent.findMany({
        where: { workspaceId: ws.workspaceId, action: 'webhook.signature_failed' },
      });
      expect(audited.length).toBeGreaterThanOrEqual(1);
      expect(audited[0]).toMatchObject({ actorType: 'WEBHOOK' });
    });

    it('an unknown account is acknowledged and ignored', async () => {
      const payload = textIn('9990000', '923331110002', 'wamid.unknown-1', 1_741_600_000, 'hello');
      await deliver(payload).expect(200);
      const stored = await t.db.prisma.webhookEvent.findFirstOrThrow({
        where: { dedupeKey: 'wa:msg:wamid.unknown-1' },
      });
      expect(stored).toMatchObject({ status: 'IGNORED', workspaceId: null });
      expect(await t.db.prisma.conversation.count()).toBe(0);
      expect(await t.db.prisma.lead.count()).toBe(0);
    });

    it('a body that is signed but not JSON is a 400', async () => {
      const body = 'not json';
      await request(t.app.getHttpServer())
        .post('/api/v1/webhooks/whatsapp')
        .set('X-Forwarded-For', '10.60.0.1')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(body))
        .send(body)
        .expect(400);
    });
  });

  describe('inbound messages (72.2)', () => {
    let ws: Awaited<ReturnType<typeof workspace>>;
    beforeAll(async () => {
      ws = await workspace('wh-inbound', '5550002');
    });
    const where = () => ({ workspaceId: ws.workspaceId });

    it('a message from an unknown number creates a lead and a linked conversation', async () => {
      const res = await deliver(
        textIn('5550002', '923331234567', 'wamid.new-1', 1_741_600_000, 'Hi, I want a sofa'),
      );
      expect(res.status).toBe(200);
      const lead = await t.db.prisma.lead.findFirstOrThrow({ where: where() });
      expect(lead).toMatchObject({
        source: 'MESSAGING',
        channel: 'WHATSAPP',
        fullName: 'Sana Malik',
        phoneNormalized: '+923331234567',
        assignedToId: null,
      });
      const conversation = await t.db.prisma.conversation.findFirstOrThrow({ where: where() });
      expect(conversation).toMatchObject({
        leadId: lead.id,
        customerId: null,
        channelType: 'WHATSAPP',
        externalContactId: '923331234567',
        unreadCount: 1,
        status: 'OPEN',
        connectionId: ws.connectionId,
      });
      expect(conversation.lastInboundAt?.toISOString()).toBe(
        new Date(1_741_600_000_000).toISOString(),
      );
      const message = await t.db.prisma.message.findFirstOrThrow({ where: where() });
      expect(message).toMatchObject({
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        body: 'Hi, I want a sofa',
        status: 'RECEIVED',
      });
      expect(
        await t.db.prisma.webhookEvent.findFirstOrThrow({
          where: { dedupeKey: 'wa:msg:wamid.new-1' },
        }),
      ).toMatchObject({
        status: 'PROCESSED',
        workspaceId: ws.workspaceId,
      });
      // the lead shows the first message on its timeline and the audit trail says the webhook did it
      expect(
        await t.db.prisma.auditEvent.count({
          where: { ...where(), action: 'lead.create', actorType: 'WEBHOOK' },
        }),
      ).toBe(1);
    });

    it('a duplicate delivery changes nothing', async () => {
      const payload = textIn(
        '5550002',
        '923331234567',
        'wamid.new-1',
        1_741_600_000,
        'Hi, I want a sofa',
      );
      await deliver(payload).expect(200);
      await deliver(payload).expect(200);
      expect(await t.db.prisma.message.count({ where: where() })).toBe(1);
      expect(await t.db.prisma.lead.count({ where: where() })).toBe(1);
      expect(
        (await t.db.prisma.conversation.findFirstOrThrow({ where: where() })).unreadCount,
      ).toBe(1);
    });

    it('later messages join the same conversation and reopen it when closed', async () => {
      await t.db.prisma.conversation.updateMany({ where: where(), data: { status: 'CLOSED' } });
      await deliver(
        textIn('5550002', '923331234567', 'wamid.new-2', 1_741_600_100, 'Any update?'),
      ).expect(200);
      const conversations = await t.db.prisma.conversation.findMany({ where: where() });
      expect(conversations).toHaveLength(1);
      expect(conversations[0]).toMatchObject({ status: 'OPEN', unreadCount: 2 });
      expect(await t.db.prisma.lead.count({ where: where() })).toBe(1);
    });

    it('a number that belongs to a customer links to the customer, not a new lead', async () => {
      await http
        .post(
          '/customers',
          { fullName: 'Existing Customer', phones: ['+92 300 5550100'] },
          ws.token,
        )
        .expect(201);
      await deliver(
        textIn('5550002', '923005550100', 'wamid.cust-1', 1_741_600_200, 'Hello again', 'Someone'),
      ).expect(200);
      const conversation = await t.db.prisma.conversation.findFirstOrThrow({
        where: { ...where(), externalContactId: '923005550100' },
      });
      const customer = await t.db.prisma.customer.findFirstOrThrow({
        where: { ...where(), fullName: 'Existing Customer' },
      });
      expect(conversation).toMatchObject({ customerId: customer.id, leadId: null });
      expect(
        await t.db.prisma.lead.count({ where: { ...where(), phoneNormalized: '+923005550100' } }),
      ).toBe(0);
    });

    it('a number with an open lead attaches to that lead', async () => {
      const lead = (
        await http
          .post('/leads', { fullName: 'Walk-in Lead', phone: '+92 300 5550200' }, ws.token)
          .expect(201)
      ).body.data as Json;
      await deliver(
        textIn('5550002', '923005550200', 'wamid.lead-1', 1_741_600_300, 'Price?'),
      ).expect(200);
      const conversation = await t.db.prisma.conversation.findFirstOrThrow({
        where: { ...where(), externalContactId: '923005550200' },
      });
      expect(conversation.leadId).toBe(lead.id);
      expect(
        await t.db.prisma.lead.count({ where: { ...where(), phoneNormalized: '+923005550200' } }),
      ).toBe(1);
    });

    it('keeps a photo in storage and the message when the file cannot be fetched', async () => {
      const adapter = t.app.get(WhatsAppAdapter);
      const spy = jest
        .spyOn(adapter, 'downloadMedia')
        .mockResolvedValueOnce({ body: await png(), mime: 'image/png' });
      await deliver(imageIn('5550002', '923331234567', 'wamid.img-1', 1_741_600_400)).expect(200);
      spy.mockRejectedValueOnce(new Error('media gone'));
      await deliver(imageIn('5550002', '923331234567', 'wamid.img-2', 1_741_600_500)).expect(200);
      spy.mockRestore();
      const ok = await t.db.prisma.message.findFirstOrThrow({
        where: { ...where(), externalId: 'wamid.img-1' },
      });
      const attachments = ok.attachments as Json[];
      expect(attachments).toHaveLength(1);
      expect(attachments[0]).toMatchObject({ mime: 'image/png' });
      expect(await t.db.prisma.fileAsset.count({ where: { id: attachments[0]?.fileId } })).toBe(1);
      const lost = await t.db.prisma.message.findFirstOrThrow({
        where: { ...where(), externalId: 'wamid.img-2' },
      });
      expect(lost.attachments).toEqual([]);
      expect(lost.channelMeta).toMatchObject({ mediaNotStored: 1 });
    });

    it('STOP withdraws consent and START restores it', async () => {
      const consent = () =>
        t.db.prisma.contactConsent.findFirst({
          where: { ...where(), externalContactId: '923331234567' },
        });
      await deliver(
        textIn('5550002', '923331234567', 'wamid.stop-1', 1_741_600_600, 'STOP'),
      ).expect(200);
      expect(await consent()).toMatchObject({ status: 'OPTED_OUT', source: 'KEYWORD' });
      await deliver(
        textIn('5550002', '923331234567', 'wamid.start-1', 1_741_600_700, ' start '),
      ).expect(200);
      expect(await consent()).toMatchObject({ status: 'OPTED_IN' });
    });

    it('moves delivery statuses forward only', async () => {
      const conversation = await t.db.prisma.conversation.findFirstOrThrow({
        where: { ...where(), externalContactId: '923331234567' },
      });
      await t.db.prisma.message.create({
        data: {
          workspaceId: ws.workspaceId,
          conversationId: conversation.id,
          externalId: 'wamid.out-1',
          direction: 'OUTBOUND',
          senderType: 'STAFF',
          status: 'QUEUED',
          providerTimestamp: new Date(1_741_600_000_000),
        },
      });
      const status = async () =>
        await t.db.prisma.message.findFirstOrThrow({
          where: { externalId: 'wamid.out-1', ...where() },
        });
      await deliver(
        statusOf('5550002', 'wamid.out-1', 'delivered', 1_741_600_050, '923331234567'),
      ).expect(200);
      expect((await status()).status).toBe('DELIVERED');
      await deliver(
        statusOf('5550002', 'wamid.out-1', 'sent', 1_741_600_040, '923331234567'),
      ).expect(200); // late: ignored
      expect((await status()).status).toBe('DELIVERED');
      await deliver(
        statusOf('5550002', 'wamid.out-1', 'failed', 1_741_600_060, '923331234567'),
      ).expect(200); // delivered cannot fail
      expect((await status()).status).toBe('DELIVERED');
      await deliver(
        statusOf('5550002', 'wamid.out-1', 'read', 1_741_600_070, '923331234567'),
      ).expect(200);
      expect((await status()).status).toBe('READ');
    });

    it('a status for a message that never becomes known fails after its retries, and is applied once the message is known', async () => {
      await deliver(
        statusOf('5550002', 'wamid.late-1', 'delivered', 1_741_600_800, '923331234567'),
      ).expect(200);
      const stored = await t.db.prisma.webhookEvent.findFirstOrThrow({
        where: { dedupeKey: 'wa:status:wamid.late-1:DELIVERED' },
      });
      expect(stored).toMatchObject({ status: 'FAILED', attempts: 4 });
      expect(
        await t.db.prisma.auditEvent.count({ where: { ...where(), action: 'webhook.failed' } }),
      ).toBeGreaterThanOrEqual(1);
      const connection = await t.db.prisma.integrationConnection.findUniqueOrThrow({
        where: { id: ws.connectionId },
      });
      expect(connection.lastError).toMatch(/not known yet/);

      // the sender stores the provider's id on the message: the waiting status is applied
      const conversation = await t.db.prisma.conversation.findFirstOrThrow({
        where: { ...where(), externalContactId: '923331234567' },
      });
      await t.db.prisma.message.create({
        data: {
          workspaceId: ws.workspaceId,
          conversationId: conversation.id,
          externalId: 'wamid.late-1',
          direction: 'OUTBOUND',
          senderType: 'STAFF',
          status: 'SENT',
          providerTimestamp: new Date(),
        },
      });
      await t.app
        .get<ClsService<RequestContext>>(ClsService)
        .runWith({ workspaceId: ws.workspaceId }, () =>
          t.app.get(ChannelInboundService).reapplyStatuses(ws.workspaceId, 'wamid.late-1'),
        );
      expect(
        (await t.db.prisma.message.findFirstOrThrow({ where: { externalId: 'wamid.late-1' } }))
          .status,
      ).toBe('DELIVERED');
      expect(
        (
          await t.db.prisma.webhookEvent.findFirstOrThrow({
            where: { dedupeKey: 'wa:status:wamid.late-1:DELIVERED' },
          })
        ).status,
      ).toBe('PROCESSED');
    });
  });

  describe('workspace isolation', () => {
    it("an event for one workspace's account never touches another workspace", async () => {
      const a = await workspace('wh-iso-a', '5550010');
      const b = await workspace('wh-iso-b', '5550011');
      await deliver(
        textIn('5550010', '923331230010', 'wamid.iso-1', 1_741_600_000, 'for A'),
      ).expect(200);
      expect(await t.db.prisma.message.count({ where: { workspaceId: a.workspaceId } })).toBe(1);
      expect(await t.db.prisma.message.count({ where: { workspaceId: b.workspaceId } })).toBe(0);
      expect(await t.db.prisma.lead.count({ where: { workspaceId: b.workspaceId } })).toBe(0);
      // a disconnected account stops receiving
      await http.post(`/integrations/${b.connectionId}/disconnect`, {}, b.token).expect(200);
      await deliver(
        textIn('5550011', '923331230011', 'wamid.iso-2', 1_741_600_000, 'for B'),
      ).expect(200);
      expect(await t.db.prisma.message.count({ where: { workspaceId: b.workspaceId } })).toBe(0);
    });
  });

  describe('Property 10 — idempotency and ordering (72.1)', () => {
    let ref: Awaited<ReturnType<typeof workspace>>;
    let mix: Awaited<ReturnType<typeof workspace>>;
    let run = 0;

    beforeAll(async () => {
      ref = await workspace('wh-prop-ref', '5550020');
      mix = await workspace('wh-prop-mix', '5550021');
    });

    type Ev = { id: string; payload: (account: string) => Json; ts: number };

    const snapshot = async (workspaceId: string, contacts: string[]) => {
      const conversations = await t.db.prisma.conversation.findMany({
        where: { workspaceId, externalContactId: { in: contacts } },
        orderBy: { externalContactId: 'asc' },
      });
      const messages = await t.db.prisma.message.findMany({
        where: { workspaceId, conversation: { externalContactId: { in: contacts } } },
        orderBy: [{ externalId: 'asc' }],
      });
      return {
        conversations: conversations.map((c) => ({
          contact: c.externalContactId,
          status: c.status,
          unread: c.unreadCount,
          lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
          lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
          linked: Boolean(c.leadId || c.customerId),
        })),
        messages: messages.map((m) => ({
          id: m.externalId?.replace(/\.\d+$/, ''),
          direction: m.direction,
          status: m.status,
          body: m.body,
          at: m.providerTimestamp.toISOString(),
        })),
      };
    };

    it('any order and any duplicates give the same conversations, messages and statuses', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 4 }), // messages from the customer
          fc.subarray(['sent', 'delivered', 'read', 'failed'], { minLength: 1 }), // statuses of one reply
          fc.subarray(['sent', 'failed'], { minLength: 1 }), // statuses of another
          fc.integer({ min: 0, max: 1_000_000 }), // seed for the shuffle
          fc.integer({ min: 0, max: 3 }), // how many events to repeat
          async (messageCount, statusesA, statusesB, seed, repeats) => {
            run += 1;
            const contact = `92300${String(run).padStart(7, '0')}`;
            const base = 1_741_700_000 + run * 1000;
            const events: Ev[] = [];
            for (let i = 0; i < messageCount; i += 1) {
              events.push({
                id: `m${run}-${i}`,
                ts: base + i * 10,
                payload: (acct) =>
                  textIn(
                    acct,
                    contact,
                    `wamid.p${run}-${i}.${acct}`,
                    base + i * 10,
                    `message ${i}`,
                  ),
              });
            }
            statusesA.forEach((s, i) =>
              events.push({
                id: `a${s}`,
                ts: base + 100 + i,
                payload: (acct) =>
                  statusOf(acct, `wamid.pa${run}.${acct}`, s, base + 100 + i, contact),
              }),
            );
            statusesB.forEach((s, i) =>
              events.push({
                id: `b${s}`,
                ts: base + 200 + i,
                payload: (acct) =>
                  statusOf(acct, `wamid.pb${run}.${acct}`, s, base + 200 + i, contact),
              }),
            );

            // both workspaces start with the same two replies waiting for their delivery statuses
            for (const w of [ref, mix]) {
              const conv = await t.db.prisma.conversation.upsert({
                where: {
                  workspaceId_connectionId_externalContactId: {
                    workspaceId: w.workspaceId,
                    connectionId: w.connectionId,
                    externalContactId: contact,
                  },
                },
                create: {
                  workspaceId: w.workspaceId,
                  connectionId: w.connectionId,
                  channelType: 'WHATSAPP',
                  externalContactId: contact,
                },
                update: {},
              });
              for (const id of [
                `wamid.pa${run}.${w === ref ? '5550020' : '5550021'}`,
                `wamid.pb${run}.${w === ref ? '5550020' : '5550021'}`,
              ]) {
                await t.db.prisma.message.create({
                  data: {
                    workspaceId: w.workspaceId,
                    conversationId: conv.id,
                    externalId: id,
                    direction: 'OUTBOUND',
                    senderType: 'STAFF',
                    status: 'SENT',
                    providerTimestamp: new Date((base - 1) * 1000),
                  },
                });
              }
            }

            // once each, in time order
            for (const e of [...events].sort((x, y) => x.ts - y.ts))
              await deliver(e.payload('5550020')).expect(200);

            // any order, with repeats
            const order = [...events];
            let s = seed;
            const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
            for (let i = order.length - 1; i > 0; i -= 1) {
              const j = Math.floor(rnd() * (i + 1));
              [order[i], order[j]] = [order[j] as Ev, order[i] as Ev];
            }
            for (let i = 0; i < repeats; i += 1)
              order.push(order[Math.floor(rnd() * order.length)] as Ev);
            for (const e of order) await deliver(e.payload('5550021')).expect(200);

            expect(await snapshot(mix.workspaceId, [contact])).toEqual(
              await snapshot(ref.workspaceId, [contact]),
            );
          },
        ),
        { numRuns: 12 },
      );
    }, 180_000);
  });
});
