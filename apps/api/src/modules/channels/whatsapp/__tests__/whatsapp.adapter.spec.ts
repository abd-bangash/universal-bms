import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import type { NormalizedEvent } from '@bms/types';
import { ProviderHttpError } from '../../../integrations/adapter-runner';
import { FREEFORM_WINDOW_MS, WhatsAppAdapter } from '../whatsapp.adapter';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recorded payloads
const fixture = (name: string): Record<string, any> =>
  JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../../../test/fixtures/whatsapp', `${name}.json`),
      'utf8',
    ),
  );
const adapter = new WhatsAppAdapter();
const ACCOUNT = '109876543210987';

describe('WhatsAppAdapter — receiving', () => {
  it('reads a text message with the sender, name, id and time', () => {
    expect(adapter.parseEvents(fixture('text-message'))).toEqual([
      {
        kind: 'message',
        dedupeKey: 'wa:msg:wamid.HBgMOTIzMzMxMjM0NTY3FQIAEhgUM0E5QjM1',
        accountId: ACCOUNT,
        externalContactId: '923331234567',
        contactPhone: '923331234567',
        contactName: 'Sana Malik',
        externalMessageId: 'wamid.HBgMOTIzMzMxMjM0NTY3FQIAEhgUM0E5QjM1',
        type: 'TEXT',
        body: 'Hi, I want one L-shaped sofa, about 8 feet, brown leather',
        timestamp: new Date(1741600000 * 1000),
      },
    ]);
  });

  it.each([
    [
      'image-message',
      'IMAGE',
      { ref: '30123456789012345', mime: 'image/jpeg' },
      'same design as this picture',
    ],
    [
      'document-message',
      'DOCUMENT',
      { ref: '30123456789012346', mime: 'application/pdf', name: 'room-plan.pdf' },
      'Room plan',
    ],
    [
      'audio-message',
      'AUDIO',
      { ref: '30123456789012347', mime: 'audio/ogg; codecs=opus' },
      undefined,
    ],
    ['video-message', 'VIDEO', { ref: '30123456789012348', mime: 'video/mp4' }, undefined],
  ])('reads %s as %s with its media reference', (name, type, media, caption) => {
    const [event] = adapter.parseEvents(fixture(name)) as Extract<
      NormalizedEvent,
      { kind: 'message' }
    >[];
    expect(event).toMatchObject({ kind: 'message', type, media: [media] });
    expect(event?.body).toBe(caption);
  });

  it('reads a location, and keeps messages it cannot understand instead of dropping them', () => {
    const [loc] = adapter.parseEvents(fixture('location-message')) as Extract<
      NormalizedEvent,
      { kind: 'message' }
    >[];
    expect(loc).toMatchObject({
      type: 'LOCATION',
      location: {
        latitude: 24.8138,
        longitude: 67.0299,
        name: 'Our house',
        address: 'Clifton, Karachi',
      },
    });
    for (const name of ['unsupported-message', 'reaction-message']) {
      const [event] = adapter.parseEvents(fixture(name)) as Extract<
        NormalizedEvent,
        { kind: 'message' }
      >[];
      expect(event).toMatchObject({ kind: 'message', type: 'UNSUPPORTED' });
      expect(event?.externalMessageId).toMatch(/^wamid\./);
    }
  });

  it('reads statuses forward, with a reason only for a failure', () => {
    const status = (name: string) => adapter.parseEvents(fixture(name))[0];
    expect(status('status-sent')).toMatchObject({
      kind: 'status',
      status: 'SENT',
      dedupeKey: 'wa:status:wamid.HBgMOTIzMzMxMjM0NTY3FQIAEhgUM0E5QjQz:SENT',
    });
    expect(status('status-delivered')).toMatchObject({ status: 'DELIVERED' });
    expect(status('status-read')).toMatchObject({ status: 'READ' });
    const failed = status('status-failed') as Extract<NormalizedEvent, { kind: 'status' }>;
    expect(failed).toMatchObject({ status: 'FAILED', reason: '131047 Re-engagement message' });
    expect(Object.keys(status('status-sent') as object)).not.toContain('reason');
  });

  it('reads several events from one delivery in order, and ignores payloads that are not messages', () => {
    expect(adapter.parseEvents(fixture('batch-mixed')).map((e) => e.dedupeKey)).toEqual([
      'wa:msg:wamid.B1',
      'wa:msg:wamid.B2',
      'wa:status:wamid.S1:DELIVERED',
    ]);
    expect(adapter.parseEvents(fixture('other-field'))).toEqual([]);
    expect(adapter.parseEvents(fixture('other-object'))).toEqual([]);
    for (const junk of [
      null,
      undefined,
      42,
      'text',
      [],
      {},
      { object: 'whatsapp_business_account' },
      { object: 'whatsapp_business_account', entry: 'x' },
    ]) {
      expect(adapter.parseEvents(junk)).toEqual([]);
      expect(adapter.extractAccountIds(junk)).toEqual([]);
    }
  });

  it('finds the account ids to resolve the workspace from', () => {
    expect(adapter.extractAccountIds(fixture('text-message'))).toEqual([ACCOUNT]);
    expect(adapter.extractAccountIds(fixture('status-read'))).toEqual([ACCOUNT]);
    expect(adapter.extractAccountIds(fixture('other-field'))).toEqual([]);
  });
});

describe('WhatsAppAdapter — verification', () => {
  const body = Buffer.from(JSON.stringify(fixture('text-message')));
  const sign = (secret: string, bytes: Buffer = body) =>
    `sha256=${createHmac('sha256', secret).update(bytes).digest('hex')}`;

  it('accepts only a signature made with the app secret over exactly these bytes', () => {
    expect(
      adapter.verifySignature(body, { 'x-hub-signature-256': sign('app-secret') }, 'app-secret'),
    ).toBe(true);
    expect(
      adapter.verifySignature(body, { 'x-hub-signature-256': sign('other-secret') }, 'app-secret'),
    ).toBe(false);
    expect(
      adapter.verifySignature(
        Buffer.from(`${body.toString()} `),
        { 'x-hub-signature-256': sign('app-secret') },
        'app-secret',
      ),
    ).toBe(false);
    for (const header of [
      undefined,
      '',
      'sha256=',
      'sha256=zz',
      'md5=abc',
      sign('app-secret').toUpperCase().replace('SHA256=', 'sha256=') + 'ff',
    ]) {
      expect(
        adapter.verifySignature(
          body,
          header === undefined ? {} : { 'x-hub-signature-256': header },
          'app-secret',
        ),
      ).toBe(false);
    }
  });

  it('answers the subscription challenge only with the right token', () => {
    const ok = {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'tok',
      'hub.challenge': '1158201444',
    };
    expect(adapter.verifyChallenge(ok, 'tok')).toBe('1158201444');
    expect(adapter.verifyChallenge({ ...ok, 'hub.verify_token': 'nope' }, 'tok')).toBeNull();
    expect(adapter.verifyChallenge({ ...ok, 'hub.mode': 'unsubscribe' }, 'tok')).toBeNull();
    expect(adapter.verifyChallenge({}, 'tok')).toBeNull();
  });

  it('allows a free-form reply only within 24 hours of the last message from the customer (42.4)', () => {
    const now = new Date('2026-03-10T12:00:00Z');
    expect(adapter.canSendFreeform({ lastInboundAt: null }, now)).toBe(false);
    expect(adapter.canSendFreeform({ lastInboundAt: new Date(now.getTime() - 60_000) }, now)).toBe(
      true,
    );
    expect(
      adapter.canSendFreeform(
        { lastInboundAt: new Date(now.getTime() - FREEFORM_WINDOW_MS + 1) },
        now,
      ),
    ).toBe(true);
    expect(
      adapter.canSendFreeform({ lastInboundAt: new Date(now.getTime() - FREEFORM_WINDOW_MS) }, now),
    ).toBe(false);
  });
});

describe('WhatsAppAdapter — sending and asking', () => {
  const conn = { phoneNumberId: ACCOUNT, wabaId: 'waba1', accessToken: 'tok-123' };
  function fakeGraph(
    respond: (
      url: string,
      init: RequestInit,
    ) => { status?: number; json?: unknown; bytes?: Buffer; headers?: Record<string, string> },
  ) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const http = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      const r = respond(url, init);
      return new Response(r.bytes ?? JSON.stringify(r.json ?? {}), {
        status: r.status ?? 200,
        headers: r.headers,
      });
    }) as typeof fetch;
    return { http, calls };
  }

  it('sends text, media and template messages in the Cloud API shape, with the token and a clean number', async () => {
    const { http, calls } = fakeGraph(() => ({ json: { messages: [{ id: 'wamid.OUT1' }] } }));
    const wa = new WhatsAppAdapter(http, 'https://graph.test/v21.0');
    await expect(
      wa.sendMessage(conn, '+92 333-1234567', { kind: 'text', body: 'Hello' }),
    ).resolves.toEqual({ externalMessageId: 'wamid.OUT1' });
    await wa.sendMessage(conn, '923331234567', {
      kind: 'media',
      mediaType: 'document',
      link: 'https://files.test/q.pdf',
      caption: 'Quotation',
      filename: 'QT-1.pdf',
    });
    await wa.sendMessage(conn, '923331234567', {
      kind: 'template',
      name: 'order_update',
      language: 'en',
      parameters: ['ORD-1', 'Ready'],
    });
    const bodies = calls.map((c) => JSON.parse(String(c.init.body)));
    expect(calls[0]?.url).toBe(`https://graph.test/v21.0/${ACCOUNT}/messages`);
    expect((calls[0]?.init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer tok-123',
    );
    expect(bodies[0]).toMatchObject({
      messaging_product: 'whatsapp',
      to: '923331234567',
      type: 'text',
      text: { body: 'Hello' },
    });
    expect(bodies[1]).toMatchObject({
      type: 'document',
      document: { link: 'https://files.test/q.pdf', caption: 'Quotation', filename: 'QT-1.pdf' },
    });
    expect(bodies[2]).toMatchObject({
      type: 'template',
      template: {
        name: 'order_update',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'ORD-1' },
              { type: 'text', text: 'Ready' },
            ],
          },
        ],
      },
    });
  });

  it('throws a ProviderHttpError for a refusal, with no response text in it', async () => {
    const wa = new WhatsAppAdapter(
      fakeGraph(() => ({
        status: 401,
        json: { error: { message: 'Invalid OAuth access token tok-123' } },
      })).http,
    );
    const error = await wa
      .sendMessage(conn, '923331234567', { kind: 'text', body: 'x' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect((error as ProviderHttpError).status).toBe(401);
    expect(String((error as Error).message)).not.toContain('tok-123');
  });

  it('downloads media in two steps and reports its type', async () => {
    const { http, calls } = fakeGraph((url) =>
      url.endsWith('/media-1')
        ? { json: { url: 'https://cdn.test/file', mime_type: 'image/jpeg' } }
        : { bytes: Buffer.from('JPEGDATA'), headers: { 'content-type': 'image/jpeg' } },
    );
    const wa = new WhatsAppAdapter(http, 'https://graph.test/v21.0');
    const media = await wa.downloadMedia(conn, 'media-1');
    expect(media.body.toString()).toBe('JPEGDATA');
    expect(media.mime).toBe('image/jpeg');
    expect((calls[1]?.init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer tok-123',
    );
  });

  it('lists templates with their approval status, and tests the connection', async () => {
    const wa = new WhatsAppAdapter(
      fakeGraph((url) =>
        url.includes('message_templates')
          ? {
              json: {
                data: [
                  {
                    name: 'order_update',
                    language: 'en',
                    status: 'APPROVED',
                    components: [{ type: 'BODY', text: 'Order {{1}} is {{2}}' }],
                  },
                  { name: 'promo', language: 'en', status: 'PAUSED', components: [] },
                ],
              },
            }
          : { json: { verified_name: 'Acme Furniture', display_phone_number: '+92 300 1234567' } },
      ).http,
    );
    expect(await wa.listTemplates(conn)).toEqual([
      { name: 'order_update', language: 'en', status: 'APPROVED', body: 'Order {{1}} is {{2}}' },
      { name: 'promo', language: 'en', status: 'PENDING', body: '' },
    ]);
    expect(await wa.testConnection(conn)).toEqual({
      ok: true,
      detail: 'Acme Furniture · +92 300 1234567',
    });
    expect(await wa.listTemplates({ ...conn, wabaId: '' })).toEqual([]);
  });
});

describe('71.1 Property 9 — normalization completeness (15.1, 15.2)', () => {
  const fixtures = [
    'text-message',
    'image-message',
    'document-message',
    'audio-message',
    'video-message',
    'location-message',
    'unsupported-message',
    'reaction-message',
    'status-sent',
    'status-delivered',
    'status-read',
    'status-failed',
    'batch-mixed',
  ];
  const complete = (e: NormalizedEvent) => {
    expect(e.dedupeKey).toMatch(/^wa:(msg|status):\S+/);
    expect(e.accountId).toBe(ACCOUNT);
    expect(Number.isNaN(e.timestamp.getTime())).toBe(false);
    if (e.kind === 'message') {
      expect(e.externalContactId).toBeTruthy();
      expect(e.externalMessageId).toBeTruthy();
      expect(e.type).toBeTruthy();
    } else if (e.kind === 'status') {
      expect(e.externalMessageId).toBeTruthy();
      expect(['SENT', 'DELIVERED', 'READ', 'FAILED']).toContain(e.status);
    }
  };

  it('every recorded payload gives events with all their required fields', () => {
    for (const name of fixtures) {
      const events = adapter.parseEvents(fixture(name));
      expect([name, events.length > 0]).toEqual([name, true]);
      events.forEach(complete);
    }
  });

  it('parsing is deterministic: the same delivery gives the same keys, however often it arrives', () => {
    for (const name of fixtures) {
      const once = adapter.parseEvents(fixture(name)).map((e) => e.dedupeKey);
      const again = adapter
        .parseEvents(JSON.parse(JSON.stringify(fixture(name))))
        .map((e) => e.dedupeKey);
      expect(again).toEqual(once);
    }
  });

  it('generated messages and statuses are complete, keep their text, and have distinct keys', () => {
    const id = fc.stringMatching(/^wamid\.[A-Za-z0-9]{6,24}$/);
    const phone = fc.stringMatching(/^92[0-9]{10}$/);
    const text = fc.string({ minLength: 0, maxLength: 200 });
    const seconds = fc.integer({ min: 1_500_000_000, max: 1_900_000_000 }).map(String);
    const type = fc.constantFrom(
      'text',
      'image',
      'document',
      'audio',
      'video',
      'location',
      'sticker',
      'button',
      'interactive',
      'order',
      'contacts',
      'system',
    );
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.record({ id, from: phone, ts: seconds, type, text }), {
          selector: (m) => m.id,
          minLength: 1,
          maxLength: 6,
        }),
        (items) => {
          const payload = fixture('text-message');
          payload.entry[0].changes[0].value.messages = items.map((m) => ({
            id: m.id,
            from: m.from,
            timestamp: m.ts,
            type: m.type,
            text: { body: m.text },
            image: { id: `media-${m.id}`, mime_type: 'image/jpeg' },
            sticker: { id: `media-${m.id}` },
            document: { id: `media-${m.id}`, filename: 'a.pdf' },
            audio: { id: `media-${m.id}` },
            video: { id: `media-${m.id}` },
            location: { latitude: 1.5, longitude: 2.5 },
          }));
          const events = adapter.parseEvents(payload);
          expect(events).toHaveLength(items.length);
          events.forEach(complete);
          expect(new Set(events.map((e) => e.dedupeKey)).size).toBe(items.length);
          events.forEach((e, i) => {
            if (e.kind === 'message' && items[i]?.type === 'text')
              expect(e.body).toBe(items[i]?.text);
          });
        },
      ),
    );
  });

  it('a payload with the wrong shapes inside never throws', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (junk) => {
        const payload = {
          object: 'whatsapp_business_account',
          entry: [
            {
              changes: [
                {
                  field: 'messages',
                  value: {
                    metadata: { phone_number_id: ACCOUNT },
                    messages: [junk],
                    statuses: [junk],
                    contacts: [junk],
                  },
                },
              ],
            },
          ],
        };
        expect(() => adapter.parseEvents(payload)).not.toThrow();
        expect(() => adapter.parseEvents(junk)).not.toThrow();
        expect(() => adapter.extractAccountIds(junk)).not.toThrow();
      }),
    );
  });
});
