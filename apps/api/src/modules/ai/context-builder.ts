import { Injectable } from '@nestjs/common';
import type { Conversation } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { amountsIn } from './grounding';
import { customerFacingAccounts } from '../finance/bank-details';
import { SettingsService } from '../settings/settings.service';
import { CORE_FIELDS, type ContextPack, type PackField, type PackProduct } from './context.types';

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'you',
  'your',
  'with',
  'that',
  'this',
  'have',
  'has',
  'are',
  'was',
  'were',
  'will',
  'would',
  'can',
  'could',
  'please',
  'want',
  'need',
  'about',
  'what',
  'how',
  'much',
  'any',
  'from',
  'but',
  'not',
  'there',
  'their',
  'them',
  'some',
  'like',
  'also',
  'just',
  'hello',
  'thanks',
  'thank',
  'price',
]);
const MAX_CANDIDATES = 8;
const BANK_INTENT =
  /\b(bank|account|iban|transfer|where (do|can|should) i pay|payment details|pay(ing)? (you|the)|easypaisa|jazzcash|deposit)\b/i;

interface PackInput {
  conversation: Conversation;
  /** Lead fields already known, as text. */
  known: Record<string, string>;
  leadCategoryIds?: string[];
}

/** Builds the context pack for a conversation from the database and the workspace's settings. */
@Injectable()
export class ContextBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async build({ conversation, known }: PackInput): Promise<ContextPack> {
    const [business, locale, industry, ai] = await Promise.all([
      this.settings.get<{ legalName?: string } | undefined>('business'),
      this.settings.get<{ currency: string }>('locale'),
      this.settings.industryProfileKey(),
      this.settings.get<{
        tone: 'FORMAL' | 'FRIENDLY';
        replyLanguage: string;
        maxReplyChars: number;
        contextMessageCount: number;
        visionEnabled: boolean;
      }>('ai'),
    ]);

    const recent = await this.prisma.scoped.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ providerTimestamp: 'desc' }, { id: 'desc' }],
      take: ai.contextMessageCount,
    });
    const messages = recent.reverse().map((m) => ({
      from: (m.direction === 'INBOUND'
        ? 'CUSTOMER'
        : m.senderType === 'AI'
          ? 'ASSISTANT'
          : 'STAFF') as 'CUSTOMER' | 'STAFF' | 'ASSISTANT',
      // text only: a picture or a file is named, never sent, unless image understanding is switched on
      text: m.body?.trim() || `[${m.type.toLowerCase()}]`,
    }));
    const customerText = messages
      .filter((m) => m.from === 'CUSTOMER')
      .map((m) => m.text)
      .join('\n');

    const [fields, flow, knowledge, products, banks] = await Promise.all([
      this.fieldList(),
      this.questionFlow(),
      this.prisma.scoped.knowledgeItem.findMany({
        where: { active: true },
        orderBy: { title: 'asc' },
        select: { title: true, body: true },
      }),
      this.candidates(customerText),
      BANK_INTENT.test(
        messages
          .filter((m) => m.from === 'CUSTOMER')
          .slice(-3)
          .map((m) => m.text)
          .join(' '),
      )
        ? customerFacingAccounts(this.prisma)
        : Promise.resolve([]),
    ]);

    const staffText = messages.filter((m) => m.from === 'STAFF').map((m) => m.text);
    const knowledgeText = knowledge.map((k) => `${k.title}\n${k.body}`);
    const bankText = banks.map((b) => Object.values(b).join(' '));
    const statedText = [...knowledgeText, ...staffText].join('\n');
    const amounts = new Set<string>();
    for (const p of products) amounts.add(new Decimal(p.price).toFixed());
    for (const text of [statedText, ...bankText]) {
      for (const a of amountsIn(text, locale.currency)) amounts.add(a.toFixed());
      for (const n of text.match(/\d+(?:\.\d+)?/g) ?? []) amounts.add(new Decimal(n).toFixed());
    }

    return {
      business: {
        name: business?.legalName ?? '',
        industryProfile: industry ?? 'general',
        currency: locale.currency,
      },
      style: { tone: ai.tone, replyLanguage: ai.replyLanguage, maxReplyChars: ai.maxReplyChars },
      customerName: conversation.contactName ?? null,
      questionFlow: flow,
      fields,
      knowledge,
      products,
      bankAccounts: banks,
      messages,
      customerText,
      statedText,
      amounts: [...amounts],
      known,
    };
  }

  // ── pieces ──────────────────────────────────────────────────────────────────────────────

  /** The core details plus every configured lead field (required ones first). */
  private async fieldList(): Promise<PackField[]> {
    const defs = await this.prisma.scoped.fieldDefinition.findMany({
      where: { entityType: 'LEAD', active: true },
      orderBy: [{ required: 'desc' }, { sortOrder: 'asc' }],
    });
    return [
      ...CORE_FIELDS,
      ...defs.map((d) => ({ key: d.key, label: d.label, type: d.type, required: d.required })),
    ];
  }

  /** The workspace's question flow; without one, the required fields in order with a plain question each. */
  private async questionFlow(): Promise<Array<{ fieldKey: string; question: string }>> {
    const flow = await this.prisma.scoped.questionFlow.findFirst({ where: { categoryId: null } });
    const steps =
      (flow?.steps as Array<{ fieldKey?: string; question?: string }> | undefined) ?? [];
    const fromFlow = steps
      .filter((s): s is { fieldKey: string; question: string } => Boolean(s.fieldKey && s.question))
      .map((s) => ({ fieldKey: s.fieldKey, question: s.question }));
    if (fromFlow.length > 0) return fromFlow;
    const required = await this.prisma.scoped.fieldDefinition.findMany({
      where: { entityType: 'LEAD', active: true, required: true },
      orderBy: { sortOrder: 'asc' },
    });
    return required.map((d) => ({
      fieldKey: d.key,
      question: `What is the ${d.label.toLowerCase()}?`,
    }));
  }

  /**
   * Products the customer may be talking about: only those the business made visible to the AI, found
   * by the words the customer used, each with its current price and what is in stock (Requirement 43.4).
   */
  private async candidates(customerText: string): Promise<PackProduct[]> {
    const terms = [
      ...new Set(
        customerText
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w)),
      ),
    ].slice(0, 30);
    if (terms.length === 0) return [];
    const rows = await this.prisma.scoped.product.findMany({
      where: {
        visibleToAi: true,
        status: 'ACTIVE',
        OR: terms.flatMap((t) => [
          { name: { contains: t, mode: 'insensitive' as const } },
          { code: { equals: t, mode: 'insensitive' as const } },
          { aliases: { has: t } },
          { tags: { has: t } },
        ]),
      },
      include: { variants: { select: { id: true } } },
      take: 40,
    });
    const scored = rows
      .map((p) => {
        const haystack = [p.name, p.code, ...p.aliases, ...p.tags].join(' ').toLowerCase();
        const hits = terms.filter((t) => haystack.includes(t)).length;
        return { p, score: Math.min(1, hits / Math.max(1, Math.min(terms.length, 4))) };
      })
      .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
      .slice(0, MAX_CANDIDATES);

    const variantIds = scored.flatMap((s) => s.p.variants.map((v) => v.id));
    const levels = variantIds.length
      ? await this.prisma.scoped.stockLevel.findMany({
          where: { variantId: { in: variantIds } },
          select: { variantId: true, onHand: true, reserved: true },
        })
      : [];
    return scored.map(({ p, score }) => {
      const ids = new Set(p.variants.map((v) => v.id));
      const available = levels
        .filter((l) => ids.has(l.variantId))
        .reduce((sum, l) => sum.plus(l.onHand).minus(l.reserved), new Decimal(0));
      const tracked = p.type === 'STOCKABLE';
      const fact: Pick<PackProduct, 'availability' | 'quantity'> = !tracked
        ? { availability: p.madeToOrder ? 'MADE_TO_ORDER' : 'NOT_TRACKED' }
        : available.gt(0)
          ? { availability: 'IN_STOCK', quantity: available.toFixed() }
          : p.madeToOrder
            ? { availability: 'MADE_TO_ORDER' }
            : { availability: 'OUT_OF_STOCK' };
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        price: p.basePrice.toFixed(),
        score: Math.round(score * 100) / 100,
        ...fact,
      };
    });
  }
}
