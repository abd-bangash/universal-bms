/** The channels the system can receive messages from and send messages through. */
export const CHANNEL_PROVIDERS = ['WHATSAPP', 'FACEBOOK_LEADS', 'INSTAGRAM'] as const;
export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];

export const MESSAGE_TYPES = [
  'TEXT',
  'IMAGE',
  'DOCUMENT',
  'AUDIO',
  'VIDEO',
  'LOCATION',
  'TEMPLATE',
  'UNSUPPORTED',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** The credentials and settings of one connected account, decrypted; only adapters ever hold these. */
export type IntegrationSecrets = Record<string, string>;

export interface MediaRef {
  /** The provider's reference to download the file with. */
  ref: string;
  mime?: string;
  name?: string;
}

/**
 * What an adapter makes of one thing a provider reported (design.md, Channels). Every adapter
 * returns these and nothing provider-shaped goes further; `dedupeKey` is the same for the same
 * provider event however many times it is delivered.
 */
export type NormalizedEvent =
  | {
      kind: 'message';
      dedupeKey: string;
      accountId: string;
      externalContactId: string;
      contactName?: string;
      contactPhone?: string;
      externalMessageId: string;
      type: Exclude<MessageType, 'TEMPLATE'>;
      body?: string;
      media?: MediaRef[];
      location?: { latitude: number; longitude: number; name?: string; address?: string };
      timestamp: Date;
    }
  | {
      kind: 'status';
      dedupeKey: string;
      accountId: string;
      externalMessageId: string;
      status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
      reason?: string;
      timestamp: Date;
    }
  | {
      kind: 'lead_form';
      dedupeKey: string;
      accountId: string;
      formId: string;
      adId?: string;
      campaign?: string;
      fields: Record<string, string>;
      timestamp: Date;
    };

export type OutboundContent =
  | { kind: 'text'; body: string }
  | {
      kind: 'media';
      mediaType: 'image' | 'document' | 'audio' | 'video';
      /** A public https link the provider can fetch, or a provider media id. */
      link?: string;
      mediaId?: string;
      caption?: string;
      filename?: string;
    }
  | {
      kind: 'template';
      name: string;
      language: string;
      /** Values for the template's {{1}}, {{2}} … in order. */
      parameters: string[];
    };

export interface SendResult {
  externalMessageId: string;
}

export interface ProviderTemplate {
  name: string;
  language: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED';
  body: string;
}

export interface HealthResult {
  ok: boolean;
  detail?: string;
}

/** Whether a free-form (non-template) message may be sent now: providers allow it only soon after the contact wrote. */
export interface FreeformState {
  lastInboundAt: Date | null;
}

export interface ChannelAdapter {
  readonly provider: ChannelProvider;
  /** Answers the provider's subscription check: the text to echo back, or null to refuse. */
  verifyChallenge(query: Record<string, string>, verifyToken: string): string | null;
  /** Whether the raw body was really signed by the provider with the platform's app secret. */
  verifySignature(rawBody: Buffer, headers: Record<string, string>, appSecret: string): boolean;
  /** The account ids a payload is for, to find the workspace. */
  extractAccountIds(payload: unknown): string[];
  parseEvents(payload: unknown): NormalizedEvent[];
  canSendFreeform(conversation: FreeformState, now?: Date): boolean;
  sendMessage(
    conn: IntegrationSecrets,
    to: string,
    content: OutboundContent,
  ): Promise<SendResult>;
  downloadMedia(conn: IntegrationSecrets, mediaRef: string): Promise<{ body: Buffer; mime: string }>;
  listTemplates?(conn: IntegrationSecrets): Promise<ProviderTemplate[]>;
  testConnection(conn: IntegrationSecrets): Promise<HealthResult>;
}
