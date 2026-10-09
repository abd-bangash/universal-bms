'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { FormShell } from '@/components/forms/form-shell';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { AI_STATUS_KEY, useAiStatus, type AiStatus } from '@/lib/hooks/use-ai';
import { Can, usePermission } from '@/lib/session';
import { KnowledgeManager } from './knowledge-manager';

interface Values {
  mode: 'OFF' | 'ASSIST';
  provider: string;
  model: string;
  tone: 'FORMAL' | 'FRIENDLY';
  replyLanguage: string;
  maxReplyChars: number;
  confidenceThreshold: number;
  escalationKeywords: string;
  contextMessageCount: number;
  dailyRequestLimit: number;
  monthlyTokenBudget: number;
}

export function AiSettings() {
  const t = useTranslations('ai.settings');
  const message = useErrorMessage();
  const status = useAiStatus();
  const canLogs = usePermission('ai:view_logs');
  if (status.isError) return <Alert>{message(status.error)}</Alert>;
  if (!status.data) return <p role="status">{t('loading')}</p>;
  const s = status.data;
  const dataPoints = t.raw('data') as string[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-neutral-600">{t('intro')}</p>
      </div>

      <section aria-labelledby="ai-usage" className="flex flex-col gap-1">
        <h2 id="ai-usage" className="font-medium">
          {t('usage')}
        </h2>
        <p className="text-sm">
          {t('usageToday', { used: s.usage.requestsToday, limit: s.usage.dailyLimit })}
        </p>
        <p className="text-sm">
          {t('usageMonth', { used: s.usage.tokensThisMonth, limit: s.usage.monthlyBudget })}
        </p>
        <p className="text-sm">{s.providerConfigured ? t('connected') : t('notConnected')}</p>
        {canLogs ? (
          <Link href="/automation/log" className="text-sm underline">
            {t('logLink')}
          </Link>
        ) : null}
      </section>

      <Can permission="ai:control" fallback={<ReadOnly status={s} />}>
        <SettingsForm status={s} />
      </Can>

      <section aria-labelledby="ai-data" className="flex flex-col gap-2">
        <h2 id="ai-data" className="font-medium">
          {t('dataTitle')}
        </h2>
        <ul className="list-disc pl-5 text-sm">
          {dataPoints.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </section>

      <Can permission="ai:control">
        <KnowledgeManager />
      </Can>
    </div>
  );
}

function ReadOnly({ status }: { status: AiStatus }) {
  const t = useTranslations('ai.settings');
  return (
    <Card>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-neutral-500">{t('mode')}</dt>
          <dd>{t(`modes.${status.mode === 'ASSIST' ? 'ASSIST' : 'OFF'}`)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">{t('tone')}</dt>
          <dd>{t(`tones.${status.settings.tone}`)}</dd>
        </div>
      </dl>
    </Card>
  );
}

function SettingsForm({ status }: { status: AiStatus }) {
  const t = useTranslations('ai.settings');
  const queryClient = useQueryClient();
  const s = status.settings;
  const form = useForm<Values>({
    defaultValues: {
      mode: status.mode === 'ASSIST' ? 'ASSIST' : 'OFF',
      provider: s.provider ?? '',
      model: s.model ?? '',
      tone: s.tone,
      replyLanguage: s.replyLanguage,
      maxReplyChars: s.maxReplyChars,
      confidenceThreshold: s.confidenceThreshold,
      escalationKeywords: s.escalationKeywords.join(', '),
      contextMessageCount: s.contextMessageCount,
      dailyRequestLimit: status.usage.dailyLimit,
      monthlyTokenBudget: status.usage.monthlyBudget,
    },
  });
  const { register } = form;
  const errors = form.formState.errors;

  async function save(v: Values) {
    const updated = await api.patch<AiStatus>('/ai/settings', {
      mode: v.mode,
      ...(v.provider ? { provider: v.provider } : {}),
      ...(v.model ? { model: v.model } : {}),
      tone: v.tone,
      replyLanguage: v.replyLanguage.trim(),
      maxReplyChars: Number(v.maxReplyChars),
      confidenceThreshold: Number(v.confidenceThreshold),
      escalationKeywords: v.escalationKeywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      contextMessageCount: Number(v.contextMessageCount),
      dailyRequestLimit: Number(v.dailyRequestLimit),
      monthlyTokenBudget: Number(v.monthlyTokenBudget),
    });
    queryClient.setQueryData(AI_STATUS_KEY, updated);
  }

  const field = (
    name: keyof Values,
    label: string,
    input: (id: string, aria: ReturnType<typeof describedBy>) => React.ReactNode,
    hint?: string,
  ) => {
    const error = errors[name]?.message;
    return (
      <Field id={`ai-${name}`} label={label} error={error} hint={hint}>
        {input(`ai-${name}`, describedBy(`ai-${name}`, { error, hint }))}
      </Field>
    );
  };

  return (
    <FormShell form={form} onSubmit={save} submitLabel={t('save')} className="flex flex-col gap-3">
      {field(
        'mode',
        t('mode'),
        (id, aria) => (
          <Select {...aria} {...register('mode')}>
            <option value="OFF">{t('modes.OFF')}</option>
            <option value="ASSIST">{t('modes.ASSIST')}</option>
          </Select>
        ),
        t('autoNote'),
      )}
      {field(
        'provider',
        t('provider'),
        (id, aria) => (
          <Select {...aria} {...register('provider')}>
            <option value="">{t('noProvider')}</option>
            {status.providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        ),
        t('providerHelp'),
      )}
      {field('model', t('model'), (id, aria) => (
        <Input {...aria} {...register('model')} />
      ))}
      {field('tone', t('tone'), (id, aria) => (
        <Select {...aria} {...register('tone')}>
          <option value="FRIENDLY">{t('tones.FRIENDLY')}</option>
          <option value="FORMAL">{t('tones.FORMAL')}</option>
        </Select>
      ))}
      {field(
        'replyLanguage',
        t('language'),
        (id, aria) => (
          <Input {...aria} {...register('replyLanguage', { required: true })} />
        ),
        t('languageHelp'),
      )}
      {field('maxReplyChars', t('maxChars'), (id, aria) => (
        <Input
          type="number"
          min={50}
          max={4000}
          {...aria}
          {...register('maxReplyChars', { valueAsNumber: true })}
        />
      ))}
      {field(
        'confidenceThreshold',
        t('threshold'),
        (id, aria) => (
          <Input
            type="number"
            step="0.05"
            min={0}
            max={1}
            {...aria}
            {...register('confidenceThreshold', { valueAsNumber: true })}
          />
        ),
        t('thresholdHelp'),
      )}
      {field(
        'escalationKeywords',
        t('keywords'),
        (id, aria) => (
          <Input {...aria} {...register('escalationKeywords')} />
        ),
        t('keywordsHelp'),
      )}
      {field(
        'contextMessageCount',
        t('context'),
        (id, aria) => (
          <Input
            type="number"
            min={1}
            max={50}
            {...aria}
            {...register('contextMessageCount', { valueAsNumber: true })}
          />
        ),
        t('contextHelp'),
      )}
      {field('dailyRequestLimit', t('daily'), (id, aria) => (
        <Input
          type="number"
          min={0}
          {...aria}
          {...register('dailyRequestLimit', { valueAsNumber: true })}
        />
      ))}
      {field('monthlyTokenBudget', t('budget'), (id, aria) => (
        <Input
          type="number"
          min={0}
          {...aria}
          {...register('monthlyTokenBudget', { valueAsNumber: true })}
        />
      ))}
    </FormShell>
  );
}
