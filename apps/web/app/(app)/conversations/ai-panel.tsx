'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import type { ConversationView } from '@/lib/hooks/use-conversations';
import {
  AI_STATUS_KEY,
  useAiStatus,
  useSuggestions,
  type DisabledReason,
  type ExtractedField,
  type RunResult,
  type SuggestionView,
} from '@/lib/hooks/use-ai';
import { Can, usePermission } from '@/lib/session';
import { cn } from '@/lib/utils';

const FUNCTIONS = [
  ['SUMMARIZE', 'summarize'],
  ['EXTRACT', 'extract'],
  ['DRAFT_REPLY', 'draft-reply'],
  ['CLASSIFY', 'classify'],
  ['NEXT_ACTION', 'next-action'],
  ['NOTE', 'note'],
] as const;

const DISABLED_TEXT: Record<DisabledReason, string> = {
  MODE_OFF: 'off',
  MODULE_DISABLED: 'moduleOff',
  CONVERSATION_OFF: 'conversationOff',
  DAILY_LIMIT: 'dailyLimit',
  TOKEN_BUDGET: 'tokenBudget',
  NOT_CONFIGURED: 'notConfigured',
};

/** What the AI assistant has to say about this conversation, with the button that puts each suggestion to use. */
export function AiPanel({ conversation: c }: { conversation: ConversationView }) {
  return (
    <Can permission="ai:use">
      <Panel conversation={c} />
    </Can>
  );
}

function Panel({ conversation: c }: { conversation: ConversationView }) {
  const t = useTranslations('ai');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const status = useAiStatus();
  const suggestions = useSuggestions(c.id);
  const [running, setRunning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Why nothing can be asked right now, shown before anyone tries (Requirement 18.6).
  const closed: DisabledReason | null = !status.data
    ? null
    : status.data.mode === 'OFF'
      ? 'MODE_OFF'
      : !status.data.moduleEnabled
        ? 'MODULE_DISABLED'
        : !c.aiEnabled
          ? 'CONVERSATION_OFF'
          : !status.data.providerConfigured
            ? 'NOT_CONFIGURED'
            : null;

  async function run(path: string, fn: string) {
    setRunning(fn);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<RunResult>(`/ai/conversations/${c.id}/${path}`);
      if (result.status === 'DISABLED')
        setNotice(t(`panel.${DISABLED_TEXT[result.reason]}` as never));
      else if (result.status === 'FAILED') setError(t('panel.failed', { code: result.code }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ai', 'suggestions', c.id] }),
        queryClient.invalidateQueries({ queryKey: AI_STATUS_KEY }),
        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
      ]);
    } catch (e) {
      setError(message(e));
    } finally {
      setRunning(null);
    }
  }

  // The newest suggestion of each kind that is still waiting, then what was decided recently.
  const all = suggestions.data ?? [];
  const waiting = all.filter((s) => s.status === 'PENDING');

  return (
    <aside aria-label={t('panel.label')}>
      <Card>
        <div className="flex flex-col gap-3 text-sm">
          <h3 className="font-medium">{t('panel.title')}</h3>
          {closed ? (
            <Alert tone="info">{t(`panel.${DISABLED_TEXT[closed]}` as never)}</Alert>
          ) : null}
          {c.needsHuman ? (
            <Alert tone="info">{t('panel.needsHuman', { reason: c.needsHumanReason ?? '' })}</Alert>
          ) : null}
          {error ? <Alert>{error}</Alert> : null}
          {notice ? <Alert tone="info">{notice}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            {FUNCTIONS.map(([fn, path]) => (
              <Button
                key={fn}
                size="sm"
                variant="outline"
                disabled={Boolean(closed) || running !== null}
                onClick={() => void run(path, fn)}
              >
                {running === fn ? t('panel.working') : t(`run.${fn}`)}
              </Button>
            ))}
          </div>
          {status.data ? (
            <p className="text-xs text-neutral-500">
              {t('panel.usage', {
                used: status.data.usage.requestsToday,
                limit: status.data.usage.dailyLimit,
              })}
            </p>
          ) : null}
          {suggestions.data && waiting.length === 0 ? (
            <p className="text-neutral-600">{t('panel.empty')}</p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {waiting.map((s) => (
              <li key={s.id}>
                <SuggestionCard suggestion={s} conversation={c} />
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </aside>
  );
}

function FlagList({ suggestion }: { suggestion: SuggestionView }) {
  const t = useTranslations('ai');
  if (suggestion.flags.length === 0) return null;
  const reasons = (suggestion.payload.reasons as string[] | undefined) ?? [];
  return (
    <div
      role="group"
      aria-label={t('flagsTitle')}
      className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900"
    >
      <p className="font-medium">{t('flagsTitle')}</p>
      <ul className="mt-1 flex flex-wrap gap-1">
        {suggestion.flags.map((f) => (
          <li key={f} className="rounded bg-amber-100 px-2 py-0.5 text-xs">
            {t.has(`flags.${f}`) ? t(`flags.${f}` as never) : f}
          </li>
        ))}
      </ul>
      {reasons.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-xs">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SuggestionCard({
  suggestion: s,
  conversation: c,
}: {
  suggestion: SuggestionView;
  conversation: ConversationView;
}) {
  const t = useTranslations('ai');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const canEditLead = usePermission('lead:edit');
  const canReply = usePermission('conversation:reply');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(String(s.payload['text'] ?? ''));
  const [values, setValues] = useState<Record<string, string>>({});

  async function decide(path: 'apply' | 'reject', payload?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/ai/suggestions/${s.id}/${path}`, payload ? { payload } : {});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ai', 'suggestions', c.id] }),
        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['leads'] }),
        queryClient.invalidateQueries({ queryKey: ['notes'] }),
      ]);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const reject = (
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide('reject')}>
      {t('draft.reject')}
    </Button>
  );

  let body: React.ReactNode = null;
  let action: React.ReactNode = null;
  const p = s.payload;
  switch (s.type) {
    case 'SUMMARY': {
      const points = (p['keyPoints'] as string[] | undefined) ?? [];
      body = (
        <>
          <p>{String(p['summary'] ?? '')}</p>
          {points.length > 0 ? (
            <ul className="mt-1 list-disc pl-4">
              {points.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          ) : null}
        </>
      );
      break;
    }
    case 'EXTRACTION': {
      const fields = (p['fields'] as ExtractedField[] | undefined) ?? [];
      const missing =
        (p['missingFields'] as
          Array<{ key: string; label: string; question: string }> | undefined) ?? [];
      const products =
        (p['productCandidates'] as
          | Array<{ productId: string; name: string; price: string; availability: string }>
          | undefined) ?? [];
      const next = p['nextQuestion'] as string | null | undefined;
      body = (
        <>
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-neutral-500">
                <th className="pr-2 font-normal">{t('extraction.field')}</th>
                <th className="pr-2 font-normal">{t('extraction.value')}</th>
                <th className="font-normal">{t('extraction.confidence')}</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.key} className="align-top">
                  <td className="pr-2">{f.label}</td>
                  <td className="pr-2">
                    <Input
                      aria-label={t('extraction.editLabel', { label: f.label })}
                      value={values[f.key] ?? f.value}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    />
                  </td>
                  <td>
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-xs',
                        f.level === 'HIGH' && 'bg-green-100 text-green-900',
                        f.level === 'MEDIUM' && 'bg-neutral-100',
                        f.level === 'LOW' && 'bg-amber-100 text-amber-900',
                      )}
                    >
                      {t(`level.${f.level}`)} {Math.round(f.confidence * 100)}%
                    </span>
                    {!f.grounded ? (
                      <span className="block text-xs text-amber-800">
                        {t('extraction.unverified')}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {missing.length > 0 ? (
            <div className="mt-2">
              <p className="font-medium">{t('extraction.missing')}</p>
              <ul className="list-disc pl-4">
                {missing.map((m) => (
                  <li key={m.key}>{m.label}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {next ? <p className="mt-1">{t('extraction.nextQuestion', { question: next })}</p> : null}
          <div className="mt-2">
            <p className="font-medium">{t('extraction.products')}</p>
            {products.length === 0 ? (
              <p className="text-neutral-600">{t('extraction.noProduct')}</p>
            ) : (
              <ul>
                {products.map((pr) => (
                  <li key={pr.productId}>
                    {pr.name} · {pr.price} · {t(`availability.${pr.availability}` as never)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      );
      action =
        canEditLead && c.leadId ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void decide('apply', {
                fields: fields.map((f) => ({ key: f.key, value: values[f.key] ?? f.value })),
                ...(products[0] ? { productId: products[0].productId } : {}),
              })
            }
          >
            {t('extraction.apply')}
          </Button>
        ) : null;
      break;
    }
    case 'CLASSIFICATION':
      body = (
        <p>
          {t('classification.intent')}:{' '}
          {t(`classification.intents.${String(p['intent'])}` as never)} ·{' '}
          {t('classification.priority')}:{' '}
          {t(`classification.priorities.${String(p['priority'])}` as never)}
        </p>
      );
      action =
        canEditLead && c.leadId ? (
          <Button size="sm" disabled={busy} onClick={() => void decide('apply')}>
            {t('classification.apply')}
          </Button>
        ) : null;
      break;
    case 'NEXT_ACTION':
      body = (
        <>
          <p>{String(p['action'] ?? '')}</p>
          {p['followUpDate'] ? (
            <p className="text-neutral-600">
              {t('next.date', { date: String(p['followUpDate']) })}
            </p>
          ) : null}
        </>
      );
      action =
        canEditLead && c.leadId ? (
          <Button size="sm" disabled={busy} onClick={() => void decide('apply')}>
            {t('next.apply')}
          </Button>
        ) : null;
      break;
    case 'NOTE':
      body = <p className="whitespace-pre-wrap">{String(p['text'] ?? '')}</p>;
      action = (
        <Button size="sm" disabled={busy} onClick={() => void decide('apply')}>
          {t('note.apply')}
        </Button>
      );
      break;
    case 'DRAFT_REPLY':
      body = (
        <Textarea
          aria-label={t('draft.edit')}
          rows={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      );
      action = canReply ? (
        <Button
          size="sm"
          disabled={busy || !draft.trim()}
          onClick={() => void decide('apply', { text: draft })}
        >
          {t('draft.send')}
        </Button>
      ) : null;
      break;
  }

  return (
    <section
      aria-label={t(`kind.${s.type}`)}
      className="flex flex-col gap-2 rounded-md border border-neutral-200 p-2"
    >
      <h4 className="font-medium">{t(`kind.${s.type}`)}</h4>
      <FlagList suggestion={s} />
      {body}
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {action}
        {s.type === 'SUMMARY' ? null : reject}
      </div>
    </section>
  );
}
