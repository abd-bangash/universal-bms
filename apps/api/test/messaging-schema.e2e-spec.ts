import { createTestApp, type TestApp } from './helpers/auth-app';
import { tenantFactories } from './helpers/tenant-factories';

describe('Messaging and AI schema (task 69)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  }, 90_000);
  afterAll(() => t.close());

  const make = async <T>(
    model: string,
    ws: string,
    read: (where: Record<string, unknown>) => Promise<T>,
  ) => read((await tenantFactories[model]!(t.db.prisma, ws)).where);

  it('one connected account belongs to one workspace across the whole platform (42.1)', async () => {
    const a = await make('IntegrationConnection', 'msg-ws-1', (where) =>
      t.db.prisma.integrationConnection.findFirstOrThrow({ where }),
    );
    // the same workspace has one connection per provider
    await expect(
      t.db.prisma.integrationConnection.create({
        data: {
          workspaceId: a.workspaceId,
          provider: a.provider,
          type: 'CHANNEL',
          configEncrypted: 'x',
        },
      }),
    ).rejects.toThrow(/Unique constraint/);
    // another workspace cannot claim the same account id for the same provider
    await tenantFactories['IntegrationConnection']!(t.db.prisma, 'msg-ws-2');
    await expect(
      t.db.prisma.integrationConnection.create({
        data: {
          workspaceId: 'msg-ws-2',
          provider: a.provider,
          type: 'CHANNEL',
          externalAccountId: a.externalAccountId,
          configEncrypted: 'x',
        },
      }),
    ).rejects.toThrow();
    // a different provider may use the same account id, and connections with no account id may coexist
    await tenantFactories['KnowledgeItem']!(t.db.prisma, 'msg-ws-3'); // creates the workspace
    await t.db.prisma.integrationConnection.create({
      data: {
        workspaceId: 'msg-ws-3',
        provider: 'INSTAGRAM',
        type: 'CHANNEL',
        externalAccountId: a.externalAccountId,
        configEncrypted: 'x',
      },
    });
    await t.db.prisma.integrationConnection.create({
      data: { workspaceId: 'msg-ws-3', provider: 'AI_FAKE', type: 'AI', configEncrypted: 'x' },
    });
  });

  it('a webhook event is stored once per provider and dedupe key (42.2)', async () => {
    const data = { provider: 'WHATSAPP', dedupeKey: 'wamid.ABC', kind: 'message', payload: {} };
    await t.db.prisma.webhookEvent.create({ data });
    await expect(t.db.prisma.webhookEvent.create({ data })).rejects.toThrow(/Unique constraint/);
    await t.db.prisma.webhookEvent.create({ data: { ...data, provider: 'INSTAGRAM' } });
    await expect(
      t.db.prisma.webhookEvent.create({ data: { ...data, dedupeKey: 'x', status: 'LOST' } }),
    ).rejects.toThrow();
    await expect(
      t.db.prisma.webhookEvent.create({ data: { ...data, dedupeKey: 'y', kind: 'gossip' } }),
    ).rejects.toThrow();
  });

  it('a contact has one conversation per connection, and a message id is stored once per conversation (15.5)', async () => {
    const convo = await make('Conversation', 'msg-ws-4', (where) =>
      t.db.prisma.conversation.findFirstOrThrow({ where }),
    );
    await expect(
      t.db.prisma.conversation.create({
        data: {
          workspaceId: convo.workspaceId,
          connectionId: convo.connectionId,
          channelType: 'WHATSAPP',
          externalContactId: convo.externalContactId,
        },
      }),
    ).rejects.toThrow(/Unique constraint/);
    const message = {
      workspaceId: convo.workspaceId,
      conversationId: convo.id,
      externalId: 'wamid.1',
      direction: 'INBOUND' as const,
      senderType: 'CUSTOMER',
      providerTimestamp: new Date(),
    };
    await t.db.prisma.message.create({ data: message });
    await expect(t.db.prisma.message.create({ data: message })).rejects.toThrow(
      /Unique constraint/,
    );
    // outbound messages have no provider id until it is accepted: several may wait
    await t.db.prisma.message.create({
      data: {
        ...message,
        externalId: null,
        direction: 'OUTBOUND',
        senderType: 'STAFF',
        status: 'QUEUED',
      },
    });
    await t.db.prisma.message.create({
      data: {
        ...message,
        externalId: null,
        direction: 'OUTBOUND',
        senderType: 'STAFF',
        status: 'QUEUED',
      },
    });
  });

  it('refuses unknown statuses, senders and negative counters', async () => {
    const convo = await make('Conversation', 'msg-ws-5', (where) =>
      t.db.prisma.conversation.findFirstOrThrow({ where }),
    );
    await expect(
      t.db.prisma.conversation.update({ where: { id: convo.id }, data: { status: 'LIMBO' } }),
    ).rejects.toThrow();
    await expect(
      t.db.prisma.conversation.update({ where: { id: convo.id }, data: { unreadCount: -1 } }),
    ).rejects.toThrow();
    const base = {
      workspaceId: convo.workspaceId,
      conversationId: convo.id,
      direction: 'INBOUND' as const,
      providerTimestamp: new Date(),
    };
    await expect(
      t.db.prisma.message.create({ data: { ...base, senderType: 'ROBOT' } }),
    ).rejects.toThrow();
    await expect(
      t.db.prisma.message.create({ data: { ...base, senderType: 'AI', status: 'TELEPATHY' } }),
    ).rejects.toThrow();
  });

  it('templates are unique by kind and name within a workspace; consent by channel and contact', async () => {
    const tpl = await make('MessageTemplate', 'msg-ws-6', (where) =>
      t.db.prisma.messageTemplate.findFirstOrThrow({ where }),
    );
    await expect(
      t.db.prisma.messageTemplate.create({
        data: { workspaceId: tpl.workspaceId, name: tpl.name, kind: tpl.kind, body: 'x' },
      }),
    ).rejects.toThrow(/Unique constraint/);
    await expect(
      t.db.prisma.messageTemplate.create({
        data: { workspaceId: tpl.workspaceId, name: 'n', kind: 'GOSSIP', body: 'x' },
      }),
    ).rejects.toThrow();
    const consent = await make('ContactConsent', 'msg-ws-6', (where) =>
      t.db.prisma.contactConsent.findFirstOrThrow({ where }),
    );
    await expect(
      t.db.prisma.contactConsent.create({
        data: {
          workspaceId: consent.workspaceId,
          channelType: consent.channelType,
          externalContactId: consent.externalContactId,
        },
      }),
    ).rejects.toThrow(/Unique constraint/);
    await expect(
      t.db.prisma.contactConsent.update({ where: { id: consent.id }, data: { status: 'MAYBE' } }),
    ).rejects.toThrow();
  });

  it('AI records keep confidence between 0 and 1, one usage row per day, and known outcomes', async () => {
    const s = await make('AISuggestion', 'msg-ws-7', (where) =>
      t.db.prisma.aISuggestion.findFirstOrThrow({ where }),
    );
    await expect(
      t.db.prisma.aISuggestion.update({ where: { id: s.id }, data: { confidence: '1.5' } }),
    ).rejects.toThrow();
    await t.db.prisma.aISuggestion.update({
      where: { id: s.id },
      data: { confidence: '0.9500', status: 'APPROVED' },
    });
    await expect(
      t.db.prisma.aISuggestion.update({ where: { id: s.id }, data: { status: 'VIBES' } }),
    ).rejects.toThrow();
    const usage = await make('AIUsage', 'msg-ws-7', (where) =>
      t.db.prisma.aIUsage.findFirstOrThrow({ where }),
    );
    await expect(
      t.db.prisma.aIUsage.create({ data: { workspaceId: usage.workspaceId, day: usage.day } }),
    ).rejects.toThrow(/Unique constraint/);
    await expect(
      t.db.prisma.aIUsage.update({ where: { id: usage.id }, data: { requests: -1 } }),
    ).rejects.toThrow();
    await expect(
      t.db.prisma.aIActionLog.create({
        data: {
          workspaceId: usage.workspaceId,
          actionType: 'X',
          providerName: 'p',
          promptVersion: 'v',
          promptHash: 'h',
          outcome: 'MAGIC',
        },
      }),
    ).rejects.toThrow();
  });

  it('conversation contacts are searchable through trigram indexes', async () => {
    const rows = await t.db.prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE indexname IN ('conversations_contact_name_trgm', 'conversations_contact_phone_trgm')`;
    expect(rows).toHaveLength(2);
  });
});
