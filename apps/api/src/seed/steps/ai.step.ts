import { Prisma } from '@prisma/client';
import { IntegrationsService } from '../../modules/integrations/integrations.service';
import type { DemoContext, DemoStep, StepResult } from '../demo-seed';
import { EVAL_CONVERSATIONS } from './ai.data';

/** How many of the evaluation conversations the demo business gets to read. */
export const DEMO_CONVERSATION_COUNT = 10;
const HOUR = 3_600_000;

/**
 * Ten WhatsApp conversations for the inbox and the AI panel to work on. They come from the AI
 * evaluation set; none is linked to a lead yet, so "Create a lead" in the inbox can be tried on them. The demo WhatsApp line is connected only to give them a channel, and disconnected
 * again: nothing in the demo can reach a real customer.
 */
export const aiStep: DemoStep = {
  name: 'ai',
  async run(ctx: DemoContext): Promise<StepResult> {
    const { unscoped } = ctx.prisma;
    const wanted = EVAL_CONVERSATIONS.slice(0, DEMO_CONVERSATION_COUNT);
    const existing = await unscoped.conversation.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        externalContactId: { in: wanted.map((c) => c.contactPhone) },
      },
      select: { externalContactId: true },
    });
    const have = new Set(existing.map((c) => c.externalContactId));
    const missing = wanted.filter((c) => !have.has(c.contactPhone));
    if (missing.length === 0) return { created: 0, existing: existing.length };

    let connection = await unscoped.integrationConnection.findFirst({
      where: { workspaceId: ctx.workspaceId, provider: 'WHATSAPP' },
    });
    if (!connection) {
      const integrations = ctx.get(IntegrationsService);
      const connected = await ctx.asOwner((owner) =>
        integrations.connect(owner, {
          provider: 'WHATSAPP',
          displayName: 'Demo WhatsApp line (not connected)',
          values: {
            phoneNumberId: `demo-${ctx.workspaceId}`,
            accessToken: 'demo-not-a-real-token',
          },
        }),
      );
      await ctx.asOwner(() => integrations.disconnect(connected.id));
      connection = await unscoped.integrationConnection.findFirstOrThrow({
        where: { id: connected.id },
      });
    }

    const now = Date.now();
    for (const [index, c] of missing.entries()) {
      const start = now - (index + 1) * 3 * HOUR;
      const messages = c.messages.map((m, i) => ({
        workspaceId: ctx.workspaceId,
        externalId: `demo-${c.id}-${i}`,
        direction: m.from === 'CUSTOMER' ? ('INBOUND' as const) : ('OUTBOUND' as const),
        senderType: m.from === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF',
        type: m.image ? 'IMAGE' : 'TEXT',
        body: m.text,
        attachments: [] as Prisma.InputJsonValue,
        status: m.from === 'CUSTOMER' ? 'RECEIVED' : 'SENT',
        providerTimestamp: new Date(start + i * 4 * 60_000),
      }));
      const lastInbound = [...messages].reverse().find((m) => m.direction === 'INBOUND');
      const conversation = await unscoped.conversation.create({
        data: {
          workspaceId: ctx.workspaceId,
          connectionId: connection.id,
          channelType: 'WHATSAPP',
          externalContactId: c.contactPhone,
          contactName: c.contactName,
          contactPhone: c.contactPhone,
          unreadCount: index < 4 ? messages.filter((m) => m.direction === 'INBOUND').length : 0,
          lastMessageAt: messages[messages.length - 1]?.providerTimestamp ?? null,
          lastInboundAt: lastInbound?.providerTimestamp ?? null,
        },
      });
      await unscoped.message.createMany({
        data: messages.map((m) => ({ ...m, conversationId: conversation.id })),
      });
    }
    return { created: missing.length, existing: existing.length };
  },
};
