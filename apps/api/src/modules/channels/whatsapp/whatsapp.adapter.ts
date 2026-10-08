import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ChannelAdapter,
  FreeformState,
  HealthResult,
  IntegrationSecrets,
  MediaRef,
  NormalizedEvent,
  OutboundContent,
  ProviderTemplate,
  SendResult,
} from '@bms/types';
import { ProviderHttpError } from '../../integrations/adapter-runner';

/** The window after the customer's last message in which free-form replies are allowed (Requirement 42.4). */
export const FREEFORM_WINDOW_MS = 24 * 60 * 60 * 1000;
const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const seconds = (v: unknown): Date => {
  const n = Number(v);
  return new Date(Number.isFinite(n) && n > 0 ? n * 1000 : 0);
};

/**
 * WhatsApp Business Platform, Cloud API. Reads webhook payloads into normalized events and talks
 * to the Graph API for sending, media and checks. The HTTP client is injectable so tests can answer
 * for the provider; failures are thrown as ProviderHttpError for the AdapterRunner to normalize.
 */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly provider = 'WHATSAPP' as const;

  constructor(
    private readonly http: typeof fetch = (...args) => fetch(...args),
    private readonly base: string = GRAPH_BASE,
  ) {}

  // ── receiving ───────────────────────────────────────────────────────────────────────────

  verifyChallenge(query: Record<string, string>, verifyToken: string): string | null {
    if (query['hub.mode'] !== 'subscribe') return null;
    const given = Buffer.from(query['hub.verify_token'] ?? '');
    const wanted = Buffer.from(verifyToken);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
    return query['hub.challenge'] ?? null;
  }

  /** `X-Hub-Signature-256: sha256=<hex>` over the exact bytes received, compared in constant time. */
  verifySignature(rawBody: Buffer, headers: Record<string, string>, appSecret: string): boolean {
    const header = headers['x-hub-signature-256'] ?? '';
    if (!header.startsWith('sha256=')) return false;
    const given = Buffer.from(header.slice('sha256='.length), 'hex');
    const wanted = createHmac('sha256', appSecret).update(rawBody).digest();
    return given.length === wanted.length && timingSafeEqual(given, wanted);
  }

  extractAccountIds(payload: unknown): string[] {
    const ids = new Set<string>();
    for (const value of this.values(payload)) {
      const id = str(obj(value['metadata'])['phone_number_id']);
      if (id) ids.add(id);
    }
    return [...ids];
  }

  parseEvents(payload: unknown): NormalizedEvent[] {
    const events: NormalizedEvent[] = [];
    for (const value of this.values(payload)) {
      const accountId = str(obj(value['metadata'])['phone_number_id']);
      if (!accountId) continue;
      const names = new Map<string, string>();
      for (const c of arr(value['contacts'])) {
        const waId = str(obj(c)['wa_id']);
        const name = str(obj(obj(c)['profile'])['name']);
        if (waId && name) names.set(waId, name);
      }
      for (const m of arr(value['messages'])) {
        const event = this.message(accountId, obj(m), names);
        if (event) events.push(event);
      }
      for (const s of arr(value['statuses'])) {
        const event = this.status(accountId, obj(s));
        if (event) events.push(event);
      }
    }
    return events;
  }

  canSendFreeform(conversation: FreeformState, now: Date = new Date()): boolean {
    return (
      conversation.lastInboundAt !== null &&
      now.getTime() - conversation.lastInboundAt.getTime() < FREEFORM_WINDOW_MS
    );
  }

  // ── sending and asking ──────────────────────────────────────────────────────────────────

  async sendMessage(
    conn: IntegrationSecrets,
    to: string,
    content: OutboundContent,
  ): Promise<SendResult> {
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/\D/g, ''),
      ...this.outbound(content),
    };
    const res = await this.call(conn, `${conn['phoneNumberId']}/messages`, {
      method: 'POST',
      body,
    });
    const id = str(obj(arr(obj(res)['messages'])[0])['id']);
    if (!id) throw new ProviderHttpError(502, 'The provider did not return a message id');
    return { externalMessageId: id };
  }

  async downloadMedia(
    conn: IntegrationSecrets,
    mediaRef: string,
  ): Promise<{ body: Buffer; mime: string }> {
    const meta = obj(await this.call(conn, mediaRef, {}));
    const url = str(meta['url']);
    if (!url) throw new ProviderHttpError(404, 'The media has no download address');
    const res = await this.http(url, {
      headers: { Authorization: `Bearer ${conn['accessToken']}` },
    });
    if (!res.ok) throw new ProviderHttpError(res.status);
    return {
      body: Buffer.from(await res.arrayBuffer()),
      mime: str(meta['mime_type']) ?? res.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async listTemplates(conn: IntegrationSecrets): Promise<ProviderTemplate[]> {
    if (!conn['wabaId']) return [];
    const res = obj(await this.call(conn, `${conn['wabaId']}/message_templates?limit=100`, {}));
    return arr(res['data']).map((t) => {
      const template = obj(t);
      const bodyComponent = arr(template['components'])
        .map(obj)
        .find((c) => c['type'] === 'BODY');
      const status = String(template['status'] ?? '');
      return {
        name: String(template['name'] ?? ''),
        language: String(template['language'] ?? ''),
        status: status === 'APPROVED' || status === 'REJECTED' ? status : 'PENDING',
        body: str(bodyComponent?.['text']) ?? '',
      };
    });
  }

  async testConnection(conn: IntegrationSecrets): Promise<HealthResult> {
    const res = obj(
      await this.call(
        conn,
        `${conn['phoneNumberId']}?fields=display_phone_number,verified_name`,
        {},
      ),
    );
    const detail = [str(res['verified_name']), str(res['display_phone_number'])]
      .filter(Boolean)
      .join(' · ');
    return { ok: true, ...(detail ? { detail } : {}) };
  }

  // ── parsing helpers ─────────────────────────────────────────────────────────────────────

  private *values(payload: unknown): Generator<Json> {
    const root = obj(payload);
    if (root['object'] !== 'whatsapp_business_account') return;
    for (const entry of arr(root['entry'])) {
      for (const change of arr(obj(entry)['changes'])) {
        if (obj(change)['field'] === 'messages') yield obj(obj(change)['value']);
      }
    }
  }

  private message(accountId: string, m: Json, names: Map<string, string>): NormalizedEvent | null {
    const id = str(m['id']);
    const from = str(m['from']);
    if (!id || !from) return null;
    const base = {
      kind: 'message' as const,
      dedupeKey: `wa:msg:${id}`,
      accountId,
      externalContactId: from,
      contactPhone: from,
      ...(names.get(from) ? { contactName: names.get(from) as string } : {}),
      externalMessageId: id,
      timestamp: seconds(m['timestamp']),
    };
    const media = (key: string): { media: MediaRef[]; body?: string } => {
      const part = obj(m[key]);
      const ref = str(part['id']);
      return {
        media: ref
          ? [
              {
                ref,
                ...(str(part['mime_type']) ? { mime: str(part['mime_type']) as string } : {}),
                ...(str(part['filename']) ? { name: str(part['filename']) as string } : {}),
              },
            ]
          : [],
        ...(str(part['caption']) ? { body: str(part['caption']) as string } : {}),
      };
    };
    switch (m['type']) {
      case 'text':
        return { ...base, type: 'TEXT', body: str(obj(m['text'])['body']) ?? '' };
      case 'image':
        return { ...base, type: 'IMAGE', ...media('image') };
      case 'sticker':
        return { ...base, type: 'IMAGE', ...media('sticker') };
      case 'document':
        return { ...base, type: 'DOCUMENT', ...media('document') };
      case 'audio':
        return { ...base, type: 'AUDIO', ...media('audio') };
      case 'video':
        return { ...base, type: 'VIDEO', ...media('video') };
      case 'location': {
        const l = obj(m['location']);
        const latitude = Number(l['latitude']);
        const longitude = Number(l['longitude']);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return { ...base, type: 'UNSUPPORTED' };
        }
        return {
          ...base,
          type: 'LOCATION',
          location: {
            latitude,
            longitude,
            ...(str(l['name']) ? { name: str(l['name']) as string } : {}),
            ...(str(l['address']) ? { address: str(l['address']) as string } : {}),
          },
        };
      }
      default:
        // buttons, lists, reactions, contacts, orders and whatever comes next are kept, not dropped
        return { ...base, type: 'UNSUPPORTED' };
    }
  }

  private status(accountId: string, s: Json): NormalizedEvent | null {
    const id = str(s['id']);
    const raw = str(s['status']);
    const map: Record<string, 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'> = {
      sent: 'SENT',
      delivered: 'DELIVERED',
      read: 'READ',
      failed: 'FAILED',
    };
    const status = raw ? map[raw] : undefined;
    if (!id || !status) return null;
    const error = obj(arr(s['errors'])[0]);
    const reason = [error['code'], str(error['title'])].filter((x) => x !== undefined).join(' ');
    return {
      kind: 'status',
      dedupeKey: `wa:status:${id}:${status}`,
      accountId,
      externalMessageId: id,
      status,
      ...(status === 'FAILED' && reason ? { reason } : {}),
      timestamp: seconds(s['timestamp']),
    };
  }

  // ── sending helpers ─────────────────────────────────────────────────────────────────────

  private outbound(content: OutboundContent): Json {
    switch (content.kind) {
      case 'text':
        return { type: 'text', text: { body: content.body, preview_url: false } };
      case 'media': {
        const source = content.mediaId ? { id: content.mediaId } : { link: content.link };
        return {
          type: content.mediaType,
          [content.mediaType]: {
            ...source,
            ...(content.caption && content.mediaType !== 'audio'
              ? { caption: content.caption }
              : {}),
            ...(content.filename && content.mediaType === 'document'
              ? { filename: content.filename }
              : {}),
          },
        };
      }
      case 'template':
        return {
          type: 'template',
          template: {
            name: content.name,
            language: { code: content.language },
            ...(content.parameters.length > 0
              ? {
                  components: [
                    {
                      type: 'body',
                      parameters: content.parameters.map((text) => ({ type: 'text', text })),
                    },
                  ],
                }
              : {}),
          },
        };
    }
  }

  private async call(
    conn: IntegrationSecrets,
    path: string,
    options: { method?: string; body?: unknown },
  ): Promise<unknown> {
    const res = await this.http(`${this.base}/${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${conn['accessToken']}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (!res.ok) throw new ProviderHttpError(res.status);
    return res.json();
  }
}
