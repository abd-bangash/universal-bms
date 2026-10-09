import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type AISuggestion, type Conversation } from '@prisma/client';
import Decimal from 'decimal.js';
import { ClsService } from 'nestjs-cls';
import type { Logger } from 'pino';
import type { z } from 'zod';
import type { TokenUsage } from '@bms/types';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  ExternalServiceException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { DomainEventBus } from '../../common/events/domain-event-bus';
import type { RequestContext } from '../../common/context/request-context';
import { LOGGER } from '../../common/logging/app-logger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LeadsService } from '../crm/leads.service';
import { NotesService } from '../crm/notes.service';
import { AdapterRunner } from '../integrations/adapter-runner';
import { ConversationsService } from '../messaging/conversations.service';
import { SettingsService } from '../settings/settings.service';
import { AIRegistry } from './ai.registry';
import { ContextBuilder } from './context-builder';
import type { ContextPack } from './context.types';
import { checkDraft, checkField, escalationFor, type CheckedField, type Flag } from './grounding';
import {
  CLASSIFY,
  DRAFT_REPLY,
  EXTRACT,
  NEXT_ACTION,
  NOTE,
  SUMMARIZE,
  type PromptSpec,
} from './prompts/prompts';
import {
  ClassificationSchema,
  DraftSchema,
  ExtractionSchema,
  NextActionSchema,
  SummarySchema,
  jsonSchemaOf,
} from './prompts/schemas';

/** AI calls are given 30 seconds (Requirement 48.8). */
export const AI_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 1200;

export type AiFunction =
  'SUMMARIZE' | 'EXTRACT' | 'DRAFT_REPLY' | 'CLASSIFY' | 'NEXT_ACTION' | 'NOTE';
export const AI_FUNCTIONS: readonly AiFunction[] = [
  'SUMMARIZE',
  'EXTRACT',
  'DRAFT_REPLY',
  'CLASSIFY',
  'NEXT_ACTION',
  'NOTE',
];

/** Why a request made no call to the provider. */
export type DisabledReason =
  | 'MODE_OFF'
  | 'MODULE_DISABLED'
  | 'CONVERSATION_OFF'
  | 'DAILY_LIMIT'
  | 'TOKEN_BUDGET'
  | 'NOT_CONFIGURED';

export interface SuggestionDto {
  id: string;
  conversationId: string | null;
  leadId: string | null;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  flags: string[];
  confidence: number | null;
  createdAt: string;
  decidedAt: string | null;
  decidedById: string | null;
}

export type RunResult =
  | { status: 'OK'; suggestion: SuggestionDto }
  | { status: 'DISABLED'; reason: DisabledReason }
  | { status: 'FAILED'; code: string };

/** The suggestion type each function produces. */
const TYPE_OF: Record<AiFunction, string> = {
  SUMMARIZE: 'SUMMARY',
  EXTRACT: 'EXTRACTION',
  DRAFT_REPLY: 'DRAFT_REPLY',
  CLASSIFY: 'CLASSIFICATION',
  NEXT_ACTION: 'NEXT_ACTION',
  NOTE: 'NOTE',
};

const PROMPT_OF: Record<AiFunction, PromptSpec> = {
  SUMMARIZE,
  EXTRACT,
  DRAFT_REPLY,
  CLASSIFY,
  NEXT_ACTION,
  NOTE,
};

const toDto = (s: AISuggestion): SuggestionDto => ({
  id: s.id,
  conversationId: s.conversationId,
  leadId: s.leadId,
  type: s.type,
  status: s.status,
  payload: s.payload as Record<string, unknown>,
  flags: s.flags,
  confidence: s.confidence ? Number(s.confidence) : null,
  createdAt: s.createdAt.toISOString(),
  decidedAt: s.decidedAt ? s.decidedAt.toISOString() : null,
  decidedById: s.decidedById,
});

const sha = (value: unknown): string =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
const startOfDay = (d = new Date()): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const startOfMonth = (d = new Date()): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

interface Produced {
  payload: Record<string, unknown>;
  flags: Flag[];
  reasons: string[];
  confidence: number | null;
}

/** The assistant settings the AI screen shows and `ai:control` may change. */
export interface AiPublicSettings {
  provider?: string;
  model?: string;
  tone: 'FORMAL' | 'FRIENDLY';
  replyLanguage: string;
  maxReplyChars: number;
  confidenceThreshold: number;
  escalationKeywords: string[];
  contextMessageCount: number;
}

interface AiSettings {
  mode: 'OFF' | 'ASSIST' | 'AUTO_REPLY';
  confidenceThreshold: number;
  escalationKeywords: string[];
  dailyRequestLimit: number;
  monthlyTokenBudget: number;
}

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registry: AIRegistry,
    private readonly runner: AdapterRunner,
    private readonly builder: ContextBuilder,
    private readonly settings: SettingsService,
    private readonly events: DomainEventBus,
    private readonly conversations: ConversationsService,
    private readonly leads: LeadsService,
    private readonly notes: NotesService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  // ── the gate ────────────────────────────────────────────────────────────────────────────

  /**
   * Whether AI may be used for this conversation right now: the workspace mode, the module, the
   * conversation's own switch and the usage limits. A closed gate means nothing is sent to the
   * provider, and nothing even asks the registry for one (Requirement 18.6).
   */
  async gate(conversation: Pick<Conversation, 'aiEnabled'>): Promise<DisabledReason | null> {
    const ai = await this.settings.get<AiSettings>('ai');
    if (ai.mode === 'OFF') return 'MODE_OFF';
    if (!(await this.settings.moduleEnabled('ai'))) return 'MODULE_DISABLED';
    if (!conversation.aiEnabled) return 'CONVERSATION_OFF';
    const usage = await this.usage(ai);
    if (usage.requestsToday >= ai.dailyRequestLimit) return 'DAILY_LIMIT';
    if (usage.tokensThisMonth >= ai.monthlyTokenBudget) return 'TOKEN_BUDGET';
    return null;
  }

  async usage(ai?: AiSettings): Promise<{
    requestsToday: number;
    dailyLimit: number;
    tokensThisMonth: number;
    monthlyBudget: number;
  }> {
    const config = ai ?? (await this.settings.get<AiSettings>('ai'));
    const [today, month] = await Promise.all([
      this.prisma.scoped.aIUsage.findFirst({ where: { day: startOfDay() } }),
      this.prisma.scoped.aIUsage.aggregate({
        where: { day: { gte: startOfMonth() } },
        _sum: { tokens: true },
      }),
    ]);
    return {
      requestsToday: today?.requests ?? 0,
      dailyLimit: config.dailyRequestLimit,
      tokensThisMonth: month._sum.tokens ?? 0,
      monthlyBudget: config.monthlyTokenBudget,
    };
  }

  /** What the screens show about AI for this workspace: mode, whether a provider is ready, and usage. */
  async status(): Promise<{
    mode: string;
    moduleEnabled: boolean;
    providerConfigured: boolean;
    provider: string | null;
    providers: string[];
    settings: AiPublicSettings;
    usage: Awaited<ReturnType<AiService['usage']>>;
  }> {
    const ai = await this.settings.get<AiSettings & AiPublicSettings>('ai');
    let providerConfigured = true;
    try {
      await this.registry.adapter();
    } catch (err) {
      if (!(err instanceof AppException) || err.code !== 'AI_UNAVAILABLE') throw err;
      providerConfigured = false;
    }
    return {
      mode: ai.mode,
      moduleEnabled: await this.settings.moduleEnabled('ai'),
      providerConfigured,
      provider: ai.provider ?? null,
      providers: this.registry.providers(),
      settings: {
        provider: ai.provider,
        model: ai.model,
        tone: ai.tone,
        replyLanguage: ai.replyLanguage,
        maxReplyChars: ai.maxReplyChars,
        confidenceThreshold: ai.confidenceThreshold,
        escalationKeywords: ai.escalationKeywords,
        contextMessageCount: ai.contextMessageCount,
      },
      usage: await this.usage(ai),
    };
  }

  /** Changes how the assistant behaves; the settings service validates the whole document and audits what changed. */
  async updateSettings(changes: Record<string, unknown>) {
    await this.settings.update({ ai: changes });
    return this.status();
  }

  // ── running a function ──────────────────────────────────────────────────────────────────

  /** Runs one function on a conversation the person may see. */
  async runFor(user: AuthUser, conversationId: string, fn: AiFunction): Promise<RunResult> {
    await this.conversations.get(user, conversationId); // 404 unless it is theirs to see
    return this.run(conversationId, fn);
  }

  /** Runs one function. The only way a provider is ever called for a conversation. */
  async run(conversationId: string, fn: AiFunction): Promise<RunResult> {
    const conversation = await this.prisma.scoped.conversation.findFirst({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundAppException();

    const closed = await this.gate(conversation);
    if (closed) {
      await this.log({
        conversation,
        fn,
        outcome:
          closed === 'DAILY_LIMIT' || closed === 'TOKEN_BUDGET' ? 'LIMIT_REACHED' : 'DISABLED',
        error: closed,
      });
      return { status: 'DISABLED', reason: closed };
    }

    let adapter;
    try {
      adapter = await this.registry.adapter();
    } catch (err) {
      if (err instanceof AppException && err.code === 'AI_UNAVAILABLE') {
        await this.log({ conversation, fn, outcome: 'DISABLED', error: 'NOT_CONFIGURED' });
        return { status: 'DISABLED', reason: 'NOT_CONFIGURED' };
      }
      throw err;
    }

    const ai = await this.settings.get<AiSettings>('ai');
    const lead = conversation.leadId
      ? await this.prisma.scoped.lead.findFirst({ where: { id: conversation.leadId } })
      : null;
    const pack = await this.builder.build({ conversation, known: knownOf(lead) });
    const lastInbound = [...pack.messages].reverse().find((m) => m.from === 'CUSTOMER')?.text ?? '';
    const escalation = escalationFor(lastInbound, ai.escalationKeywords);
    const prompt = PROMPT_OF[fn];
    const system = prompt.system(pack);
    const user = prompt.user(pack);
    const promptHash = sha({ system, user });

    const started = Date.now();
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let model: string | undefined;
    let produced: Produced;
    try {
      const raw = await this.runner.run(
        adapter.provider,
        fn,
        async () => {
          const messages = [{ role: 'user' as const, content: user }];
          if (fn === 'NOTE') {
            const r = await adapter.generateText({
              system,
              messages,
              maxTokens: MAX_TOKENS,
              timeoutMs: AI_TIMEOUT_MS,
            });
            return { kind: 'text' as const, ...r };
          }
          const schema = SCHEMA_OF[fn] as z.ZodType;
          const r = await adapter.generateStructured<unknown>({
            system,
            messages,
            schema: jsonSchemaOf(schema),
            schemaName: fn,
            maxTokens: MAX_TOKENS,
            timeoutMs: AI_TIMEOUT_MS,
          });
          return { kind: 'structured' as const, ...r };
        },
        { timeoutMs: AI_TIMEOUT_MS },
      );
      usage = raw.usage;
      model = raw.model;
      produced = this.process(
        fn,
        raw.kind === 'text' ? raw.text : raw.data,
        pack,
        ai.confidenceThreshold,
      );
    } catch (err) {
      const code =
        err instanceof ExternalServiceException
          ? err.normalizedCode
          : err instanceof InvalidOutput
            ? 'INVALID_OUTPUT'
            : 'UNKNOWN';
      await this.countUsage(usage, true);
      await this.log({
        conversation,
        fn,
        providerName: adapter.provider,
        modelVersion: model,
        promptHash,
        usage,
        latencyMs: Date.now() - started,
        outcome: code === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED',
        error: code,
      });
      this.logger.warn({ conversationId, fn, code }, 'AI call produced no suggestion');
      await this.escalate(
        conversation,
        ['AI_FAILED'],
        ['The AI assistant could not answer; a person needs to look at this.'],
      );
      return { status: 'FAILED', code };
    }

    const flags = [...new Set([...produced.flags, ...escalation.flags])] as Flag[];
    const reasons = [...produced.reasons, ...escalation.reasons];
    const latencyMs = Date.now() - started;
    await this.countUsage(usage, true);
    const suggestion = await this.prisma.scoped.$transaction(async (tx) => {
      // a newer suggestion of the same kind replaces the one still waiting
      await tx.aISuggestion.updateMany({
        where: { conversationId: conversation.id, type: TYPE_OF[fn], status: 'PENDING' },
        data: { status: 'SUPERSEDED' },
      });
      const row = await tx.aISuggestion.create({
        data: {
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          leadId: conversation.leadId,
          type: TYPE_OF[fn],
          payload: { ...produced.payload, reasons } as Prisma.InputJsonValue,
          flags,
          confidence:
            produced.confidence === null
              ? null
              : new Prisma.Decimal(produced.confidence.toFixed(4)),
        },
      });
      await tx.aIActionLog.create({
        data: {
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          suggestionId: row.id,
          actionType: fn,
          providerName: adapter.provider,
          modelVersion: model ?? null,
          promptVersion: prompt.version,
          promptHash,
          responseHash: sha(produced.payload),
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs,
          confidenceScore:
            produced.confidence === null
              ? null
              : new Prisma.Decimal(produced.confidence.toFixed(4)),
          outcome: 'SUCCESS',
        },
      });
      return row;
    });

    const lowConfidence =
      produced.confidence !== null && produced.confidence < ai.confidenceThreshold;
    if (flags.length > 0 || lowConfidence) {
      await this.escalate(
        conversation,
        flags.length > 0 ? flags : ['LOW_CONFIDENCE'],
        reasons.length > 0 ? reasons : ['The assistant is not confident about this answer.'],
      );
    }
    await this.events.publish('ai.suggestion_created', {
      workspaceId: conversation.workspaceId,
      suggestionId: suggestion.id,
      conversationId: conversation.id,
    });
    return { status: 'OK', suggestion: toDto(suggestion) };
  }

  /** The automatic step after a customer writes (ASSIST mode): fill in what they want, then draft a reply. */
  async assist(conversationId: string): Promise<void> {
    for (const fn of ['EXTRACT', 'DRAFT_REPLY'] as const) {
      const result = await this.run(conversationId, fn);
      if (result.status !== 'OK') return; // closed gate or a failure: the second call would only repeat it
    }
  }

  // ── post-processing, one function at a time ─────────────────────────────────────────────

  private process(fn: AiFunction, raw: unknown, pack: ContextPack, threshold: number): Produced {
    const parse = <S extends z.ZodType>(schema: S): z.infer<S> => {
      const out = schema.safeParse(raw);
      if (!out.success) throw new InvalidOutput();
      return out.data;
    };
    switch (fn) {
      case 'SUMMARIZE':
        return { payload: parse(SummarySchema), flags: [], reasons: [], confidence: null };
      case 'NOTE': {
        const text = typeof raw === 'string' ? raw.trim() : '';
        if (!text) throw new InvalidOutput();
        return { payload: { text }, flags: [], reasons: [], confidence: null };
      }
      case 'CLASSIFY': {
        const out = parse(ClassificationSchema);
        const flags: Flag[] = [];
        const reasons: string[] = [];
        if (out.confidence < threshold) {
          flags.push('LOW_CONFIDENCE');
          reasons.push('The assistant is not sure how to classify this.');
        }
        if (out.intent === 'COMPLAINT') {
          flags.push('COMPLAINT');
          reasons.push('The customer seems to be complaining.');
        }
        return { payload: out, flags, reasons, confidence: out.confidence };
      }
      case 'NEXT_ACTION': {
        const out = parse(NextActionSchema);
        const today = startOfDay().toISOString().slice(0, 10);
        const date =
          out.followUpDate &&
          /^\d{4}-\d{2}-\d{2}$/.test(out.followUpDate) &&
          out.followUpDate >= today
            ? out.followUpDate
            : null;
        const flags: Flag[] = out.confidence < threshold ? ['LOW_CONFIDENCE'] : [];
        return {
          payload: { action: out.action, followUpDate: date },
          flags,
          reasons: flags.length ? ['The assistant is not sure what to do next.'] : [],
          confidence: out.confidence,
        };
      }
      case 'DRAFT_REPLY': {
        const out = parse(DraftSchema);
        const check = checkDraft(out.text, {
          amounts: pack.amounts.map((a) => new Decimal(a)),
          products: pack.products,
          statedText: pack.statedText,
          currencyCode: pack.business.currency,
          maxChars: pack.style.maxReplyChars,
        });
        const flags = [...check.flags];
        const reasons = [...check.reasons];
        if (out.confidence < threshold) {
          flags.push('LOW_CONFIDENCE');
          reasons.push('The assistant is not confident in this reply.');
        }
        return { payload: { text: out.text }, flags, reasons, confidence: out.confidence };
      }
      case 'EXTRACT':
        return this.processExtraction(parse(ExtractionSchema), pack, threshold);
    }
  }

  private processExtraction(
    out: z.infer<typeof ExtractionSchema>,
    pack: ContextPack,
    threshold: number,
  ): Produced {
    const allowed = new Map(pack.fields.map((f) => [f.key, f]));
    const best = new Map<string, CheckedField>();
    for (const f of out.fields) {
      if (!allowed.has(f.key)) continue; // a key we did not ask about is dropped
      const checked = checkField(
        { key: f.key, value: f.value.trim(), reported: f.confidence },
        pack.customerText,
        threshold,
      );
      const prior = best.get(f.key);
      if (!prior || checked.confidence > prior.confidence) best.set(f.key, checked);
    }
    const fields = [...best.values()].map((f) => ({
      key: f.key,
      label: allowed.get(f.key)?.label ?? f.key,
      value: f.value,
      confidence: Math.round(f.confidence * 100) / 100,
      level: f.level,
      grounded: f.grounded,
    }));

    const known = new Set([...Object.keys(pack.known), ...fields.map((f) => f.key)]);
    const wanted = [
      ...pack.questionFlow.map((q) => q.fieldKey),
      ...pack.fields.filter((f) => f.required).map((f) => f.key),
    ];
    const missing = [...new Set(wanted)]
      .filter((key) => !known.has(key))
      .map((key) => ({
        key,
        label: allowed.get(key)?.label ?? key,
        question:
          pack.questionFlow.find((q) => q.fieldKey === key)?.question ??
          `What is the ${(allowed.get(key)?.label ?? key).toLowerCase()}?`,
      }));

    const candidates = new Map(pack.products.map((p) => [p.id, p]));
    const flags: Flag[] = [];
    const reasons: string[] = [];
    const matched = new Set<string>();
    for (const m of out.productMatches) {
      if (candidates.has(m.productId)) matched.add(m.productId);
      else {
        flags.push('UNKNOWN_PRODUCT');
        reasons.push('The assistant named a product that is not in your catalog; it was left out.');
      }
    }
    const productCandidates = [...matched].map((id) => {
      const p = candidates.get(id)!;
      return {
        productId: p.id,
        name: p.name,
        code: p.code,
        price: p.price,
        availability: p.availability,
        score: p.score,
      };
    });

    const confidence =
      fields.length > 0 ? fields.reduce((sum, f) => sum + f.confidence, 0) / fields.length : null;
    if (confidence !== null && confidence < threshold) {
      flags.push('LOW_CONFIDENCE');
      reasons.push('Some of what was extracted is not clearly stated in the conversation.');
    }
    return {
      payload: {
        fields,
        missingFields: missing,
        nextQuestion: missing[0]?.question ?? null,
        productCandidates,
        noProductMatch: productCandidates.length === 0,
      },
      flags: [...new Set(flags)],
      reasons: [...new Set(reasons)],
      confidence,
    };
  }

  // ── escalation, usage and the action log ────────────────────────────────────────────────

  private async escalate(
    conversation: Conversation,
    flags: string[],
    reasons: string[],
  ): Promise<void> {
    const reason = (reasons[0] ?? flags.join(', ')).slice(0, 200);
    const fresh = await this.prisma.scoped.conversation.findFirst({
      where: { id: conversation.id },
    });
    await this.prisma.scoped.conversation.update({
      where: { id: conversation.id },
      data: { needsHuman: true, needsHumanReason: reason },
    });
    if (!fresh?.needsHuman) {
      await this.events.publish('ai.escalated', {
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
      });
    }
  }

  private async countUsage(usage: TokenUsage, requested: boolean): Promise<void> {
    if (!requested) return;
    const day = startOfDay();
    const workspaceId = this.cls.get('workspaceId');
    if (!workspaceId) return;
    await this.prisma.scoped.aIUsage.upsert({
      where: { workspaceId_day: { workspaceId, day } },
      create: { workspaceId, day, requests: 1, tokens: usage.inputTokens + usage.outputTokens },
      update: {
        requests: { increment: 1 },
        tokens: { increment: usage.inputTokens + usage.outputTokens },
      },
    });
  }

  private async log(input: {
    conversation: Conversation;
    fn: AiFunction;
    outcome: 'DISABLED' | 'LIMIT_REACHED' | 'FAILED' | 'TIMEOUT';
    error?: string;
    providerName?: string;
    modelVersion?: string;
    promptHash?: string;
    usage?: TokenUsage;
    latencyMs?: number;
  }): Promise<void> {
    await this.prisma.scoped.aIActionLog.create({
      data: {
        workspaceId: input.conversation.workspaceId,
        conversationId: input.conversation.id,
        actionType: input.fn,
        providerName: input.providerName ?? 'NONE',
        modelVersion: input.modelVersion ?? null,
        promptVersion: PROMPT_OF[input.fn].version,
        promptHash: input.promptHash ?? '',
        inputTokens: input.usage?.inputTokens ?? 0,
        outputTokens: input.usage?.outputTokens ?? 0,
        latencyMs: input.latencyMs ?? null,
        outcome: input.outcome,
        error: input.error ?? null,
      },
    });
  }

  // ── reading ─────────────────────────────────────────────────────────────────────────────

  async suggestions(user: AuthUser, conversationId: string): Promise<SuggestionDto[]> {
    await this.conversations.get(user, conversationId);
    const rows = await this.prisma.scoped.aISuggestion.findMany({
      where: { conversationId, status: { not: 'SUPERSEDED' } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return rows.map(toDto);
  }

  // ── a person decides ────────────────────────────────────────────────────────────────────

  /**
   * Writes an approved suggestion where it belongs: the lead, a note, or a sent message. Nothing is
   * written before this call (Requirement 18.4). `payload`, when given, replaces the suggested one,
   * which makes the suggestion EDITED; the approver and the AI as the source are recorded.
   */
  async apply(
    user: AuthUser,
    id: string,
    edited?: Record<string, unknown>,
  ): Promise<SuggestionDto> {
    const suggestion = await this.pending(user, id);
    const stored = suggestion.payload as Record<string, unknown>;
    const payload = edited ?? stored;
    const changed = edited !== undefined && JSON.stringify(edited) !== JSON.stringify(stored);
    const conversation = suggestion.conversationId
      ? await this.prisma.scoped.conversation.findFirst({
          where: { id: suggestion.conversationId },
        })
      : null;

    switch (suggestion.type) {
      case 'EXTRACTION':
        await this.applyExtraction(user, conversation, payload);
        break;
      case 'CLASSIFICATION':
        await this.applyToLead(user, conversation, { priority: String(payload['priority'] ?? '') });
        break;
      case 'NEXT_ACTION':
        await this.applyToLead(user, conversation, {
          nextAction: String(payload['action'] ?? ''),
          nextActionDate: payload['followUpDate']
            ? `${String(payload['followUpDate'])}T09:00:00.000Z`
            : null,
        });
        break;
      case 'NOTE':
        await this.applyNote(user, conversation, String(payload['text'] ?? ''));
        break;
      case 'DRAFT_REPLY': {
        this.need(user, 'conversation:reply');
        if (!conversation) throw new NotFoundAppException();
        const text = String(payload['text'] ?? '').trim();
        if (!text) throw new ValidationFailedException({ text: ['is required'] });
        await this.conversations.send(user, conversation.id, { body: text });
        break;
      }
      default:
        throw new AppException(
          'VALIDATION_FAILED',
          422,
          'This kind of suggestion has nothing to apply',
        );
    }

    const decided = await this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.aISuggestion.update({
        where: { id },
        data: {
          status: changed ? 'EDITED' : 'APPROVED',
          decidedById: user.userId,
          decidedAt: new Date(),
          appliedPayload: payload as Prisma.InputJsonValue,
        },
      });
      await tx.aIActionLog.updateMany({
        where: { suggestionId: id },
        data: { humanApproved: true, approvedById: user.userId, approvedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'ai.apply',
        entityType: 'AISuggestion',
        entityId: id,
        after: { type: suggestion.type, status: row.status },
        metadata: { source: 'AI', approvedById: user.userId, edited: changed },
      });
      return row;
    });
    return toDto(decided);
  }

  async reject(user: AuthUser, id: string): Promise<SuggestionDto> {
    await this.pending(user, id);
    const row = await this.prisma.scoped.$transaction(async (tx) => {
      const updated = await tx.aISuggestion.update({
        where: { id },
        data: { status: 'REJECTED', decidedById: user.userId, decidedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'ai.reject',
        entityType: 'AISuggestion',
        entityId: id,
        metadata: { source: 'AI', rejectedById: user.userId },
      });
      return updated;
    });
    return toDto(row);
  }

  private async pending(user: AuthUser, id: string): Promise<AISuggestion> {
    const row = await this.prisma.scoped.aISuggestion.findFirst({ where: { id } });
    if (!row) throw new NotFoundAppException();
    if (row.conversationId) await this.conversations.get(user, row.conversationId);
    if (row.status !== 'PENDING') {
      throw new AppException(
        'VALIDATION_FAILED',
        422,
        'This suggestion has already been dealt with',
      );
    }
    return row;
  }

  private async applyExtraction(
    user: AuthUser,
    conversation: Conversation | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const entries = Array.isArray(payload['fields'])
      ? (payload['fields'] as Array<Record<string, unknown>>)
      : [];
    const values = new Map(entries.map((f) => [String(f['key']), String(f['value'] ?? '').trim()]));
    const dto: Record<string, unknown> = {};
    const custom: Record<string, unknown> = {};
    const [definitions, units] = await Promise.all([
      this.prisma.scoped.fieldDefinition.findMany({ where: { entityType: 'LEAD', active: true } }),
      this.prisma.scoped.unit.findMany({ select: { symbol: true } }),
    ]);
    const byKey = new Map(definitions.map((d) => [d.key, d]));
    for (const [key, value] of values) {
      if (value === '') continue;
      if (key === 'fullName' || key === 'email' || key === 'interest' || key === 'requirements') {
        dto[key] = value;
      } else if (key === 'quantity' || key === 'budget') {
        const number = toDecimalString(value);
        if (number === null) throw new ValidationFailedException({ [key]: ['must be a number'] });
        dto[key === 'budget' ? 'estimatedValue' : 'quantity'] = number;
      } else {
        const definition = byKey.get(key);
        if (!definition) continue; // not a detail this workspace records
        const coerced = await this.coerce(
          definition,
          value,
          conversation,
          new Set(units.map((u) => u.symbol)),
        );
        if (coerced !== undefined) custom[key] = coerced;
      }
    }
    if (typeof payload['productId'] === 'string') dto['productId'] = payload['productId'];
    await this.applyToLead(user, conversation, dto, custom);
  }

  /** Turns what the customer said into what the field stores: an option key, a measurement, a number, a picture. */
  private async coerce(
    definition: {
      key: string;
      label: string;
      type: string;
      options: Prisma.JsonValue;
      defaultUnit: string | null;
    },
    value: string,
    conversation: Conversation | null,
    unitSymbols: Set<string>,
  ): Promise<unknown> {
    const fail = (why: string): never => {
      throw new ValidationFailedException({ [definition.key]: [why] });
    };
    switch (definition.type) {
      case 'DROPDOWN': {
        const options = Array.isArray(definition.options)
          ? (definition.options as Array<{ key: string; label: string }>)
          : [];
        const wanted = value.trim().toLowerCase();
        const hit = options.find(
          (o) => o.key.toLowerCase() === wanted || o.label.toLowerCase() === wanted,
        );
        return hit
          ? hit.key
          : fail(`${definition.label} must be one of: ${options.map((o) => o.label).join(', ')}`);
      }
      case 'NUMBER': {
        const number = toDecimalString(value);
        return number ?? fail(`${definition.label} must be a number`);
      }
      case 'MEASUREMENT': {
        const m = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z"'²]*)\s*$/.exec(value);
        if (!m) return fail(`${definition.label} must be a number and a unit, such as 8 ft`);
        const unit = m[2]
          ? (UNIT_WORDS[m[2].toLowerCase()] ?? m[2])
          : (definition.defaultUnit ?? '');
        if (!unit || !unitSymbols.has(unit))
          return fail(`${definition.label}: the unit is not known`);
        return { value: m[1], unit };
      }
      case 'IMAGE': {
        // the picture is the one the customer sent in this conversation
        if (!conversation) return undefined;
        const withPicture = await this.prisma.scoped.message.findFirst({
          where: { conversationId: conversation.id, direction: 'INBOUND', type: 'IMAGE' },
          orderBy: [{ providerTimestamp: 'desc' }, { id: 'desc' }],
        });
        const file = ((withPicture?.attachments ?? []) as Array<{ fileId?: string }>)[0];
        return file?.fileId;
      }
      default:
        return value;
    }
  }

  private async applyToLead(
    user: AuthUser,
    conversation: Conversation | null,
    changes: Record<string, unknown>,
    customFields: Record<string, unknown> = {},
  ): Promise<void> {
    this.need(user, 'lead:edit');
    if (!conversation?.leadId) {
      throw new AppException('VALIDATION_FAILED', 422, 'Create a lead for this conversation first');
    }
    const lead = await this.leads.get(user, conversation.leadId);
    await this.leads.update(user, lead.id, {
      version: lead.version,
      ...changes,
      ...(Object.keys(customFields).length > 0
        ? { customFields: { ...lead.customFields, ...customFields } }
        : {}),
    } as never);
  }

  private async applyNote(
    user: AuthUser,
    conversation: Conversation | null,
    text: string,
  ): Promise<void> {
    if (!text.trim()) throw new ValidationFailedException({ text: ['is required'] });
    const target = conversation?.leadId
      ? ({ entityType: 'LEAD', entityId: conversation.leadId } as const)
      : conversation?.customerId
        ? ({ entityType: 'CUSTOMER', entityId: conversation.customerId } as const)
        : null;
    if (!target) {
      throw new AppException(
        'VALIDATION_FAILED',
        422,
        'Link this conversation to a customer or a lead first',
      );
    }
    await this.notes.create(user, {
      ...target,
      body: `${text.trim()}\n\n(Written with the AI assistant and approved by a person.)`,
      kind: 'NOTE',
    });
  }

  private need(user: AuthUser, permission: string): void {
    if (!user.permissions.includes(permission)) {
      throw new AppException('PERMISSION_DENIED', 403, 'You do not have permission to do this');
    }
  }
}

class InvalidOutput extends Error {}

/** How customers write units, and the symbol the system keeps. */
const UNIT_WORDS: Record<string, string> = {
  ft: 'ft',
  feet: 'ft',
  foot: 'ft',
  "'": 'ft',
  in: 'in',
  inch: 'in',
  inches: 'in',
  '"': 'in',
  cm: 'cm',
  centimeter: 'cm',
  centimeters: 'cm',
  centimetre: 'cm',
  centimetres: 'cm',
  m: 'm',
  meter: 'm',
  meters: 'm',
  metre: 'm',
  metres: 'm',
  mm: 'mm',
};

const SCHEMA_OF = {
  SUMMARIZE: SummarySchema,
  EXTRACT: ExtractionSchema,
  DRAFT_REPLY: DraftSchema,
  CLASSIFY: ClassificationSchema,
  NEXT_ACTION: NextActionSchema,
} as const;

/** What the lead already records, as text, so the assistant does not ask for it again. */
function knownOf(
  lead: {
    fullName: string;
    email: string | null;
    interest: string | null;
    requirements: string | null;
    customFields: Prisma.JsonValue;
  } | null,
): Record<string, string> {
  if (!lead) return {};
  const known: Record<string, string> = {};
  if (lead.fullName) known['fullName'] = lead.fullName;
  if (lead.email) known['email'] = lead.email;
  if (lead.interest) known['interest'] = lead.interest;
  if (lead.requirements) known['requirements'] = lead.requirements;
  for (const [k, v] of Object.entries((lead.customFields ?? {}) as Record<string, unknown>)) {
    if (v !== null && v !== undefined && v !== '')
      known[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return known;
}

/** "Rs 150,000" and "150000" are both 150000; words are not numbers. */
function toDecimalString(text: string): string | null {
  const cleaned = text.replace(/[^\d.]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return new Decimal(cleaned).toFixed();
}
