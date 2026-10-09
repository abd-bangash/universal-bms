'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/errors';
import { useErrorMessage } from '@/lib/error-message';
import { useTemplates, type TemplateView } from '@/lib/hooks/use-conversations';
import { Can, usePermission } from '@/lib/session';

const KINDS = ['QUICK_REPLY', 'MESSAGE', 'BANK_DETAILS', 'NOTIFICATION', 'PROVIDER'] as const;

interface Draft {
  id: string | null;
  name: string;
  kind: (typeof KINDS)[number];
  body: string;
  providerName: string;
  language: string;
}
const EMPTY: Draft = {
  id: null,
  name: '',
  kind: 'QUICK_REPLY',
  body: '',
  providerName: '',
  language: '',
};

/** Quick replies, message templates, the bank-details message and the provider's approved templates. */
export function TemplatesManager() {
  const t = useTranslations('automation.templates');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const canEdit = usePermission('template:configure');
  const templates = useTemplates();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ['templates'] });
      if (done) setNotice(done);
      setDraft(null);
    } catch (e) {
      const detail = e instanceof ApiError ? Object.values(e.details ?? {})[0]?.[0] : undefined;
      setError(detail ? `${message(e)} ${detail}` : message(e));
    }
  }

  function save(d: Draft) {
    const provider = d.kind === 'PROVIDER';
    return act(() =>
      d.id
        ? api.patch(`/templates/${d.id}`, {
            name: d.name.trim(),
            body: d.body,
            ...(provider
              ? { providerName: d.providerName.trim(), language: d.language.trim() }
              : {}),
          })
        : api.post('/templates', {
            name: d.name.trim(),
            kind: d.kind,
            body: d.body,
            ...(provider
              ? { providerName: d.providerName.trim(), language: d.language.trim() }
              : {}),
          }),
    );
  }

  const list = templates.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-neutral-600">{t('intro')}</p>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {templates.isPending ? <p role="status">{t('loading')}</p> : null}
      {templates.data && list.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('none')}</p>
      ) : null}
      {KINDS.map((kind) => {
        const group = list.filter((x) => x.kind === kind);
        if (group.length === 0) return null;
        return (
          <section key={kind} aria-label={t(`kinds.${kind}`)} className="flex flex-col gap-2">
            <h2 className="font-medium">{t(`kinds.${kind}`)}</h2>
            <ul className="flex flex-col gap-2">
              {group.map((x) => (
                <li key={x.id} className="rounded-md border border-neutral-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{x.name}</span>
                    <span className="flex items-center gap-2">
                      {x.kind === 'PROVIDER' && x.providerStatus ? (
                        <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs">
                          {t(`status.${x.providerStatus}`)}
                        </span>
                      ) : null}
                      {canEdit ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={t('edit', { name: x.name })}
                          onClick={() => setDraft(fromTemplate(x))}
                        >
                          {t('editTitle')}
                        </Button>
                      ) : null}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-neutral-700">{x.body}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <Can permission="template:configure">
        {draft ? (
          <form
            aria-label={draft.id ? t('editTitle') : t('new')}
            className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save(draft);
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              {t('name')}
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
                maxLength={80}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('kind')}
              <Select
                value={draft.kind}
                disabled={Boolean(draft.id)}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft['kind'] })}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </option>
                ))}
              </Select>
            </label>
            {draft.kind === 'PROVIDER' ? (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  {t('providerName')}
                  <Input
                    value={draft.providerName}
                    onChange={(e) => setDraft({ ...draft, providerName: e.target.value })}
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t('language')}
                  <Input
                    value={draft.language}
                    onChange={(e) => setDraft({ ...draft, language: e.target.value })}
                    required
                    maxLength={20}
                  />
                </label>
              </>
            ) : null}
            <label className="flex flex-col gap-1 text-sm">
              {t('body')}
              <Textarea
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                required
                rows={4}
                maxLength={4096}
              />
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={!draft.name.trim() || !draft.body.trim()}>
                {t('save')}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                {t('cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDraft({ ...EMPTY })}>
              {t('add')}
            </Button>
            <Button
              variant="outline"
              onClick={() => void act(() => api.post('/templates/sync'), t('synced'))}
            >
              {t('sync')}
            </Button>
          </div>
        )}
      </Can>
    </div>
  );
}

function fromTemplate(x: TemplateView): Draft {
  return {
    id: x.id,
    name: x.name,
    kind: x.kind as Draft['kind'],
    body: x.body,
    providerName: x.providerName ?? '',
    language: x.language ?? '',
  };
}
