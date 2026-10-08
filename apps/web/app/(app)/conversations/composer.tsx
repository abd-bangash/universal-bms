'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import {
  useTemplates,
  type ConversationView,
  type TemplateView,
} from '@/lib/hooks/use-conversations';
import { usePermission } from '@/lib/session';
import { AttachDialog, type AttachmentChoice } from './attach-dialog';

/** The numbered placeholders ({{1}}, {{2}}) of a provider template, in order. */
const numbered = (t: TemplateView): string[] => t.variables.filter((v) => /^\d+$/.test(v));

export function Composer({ conversation: c }: { conversation: ConversationView }) {
  const t = useTranslations('conversations.composer');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const canReply = usePermission('conversation:reply');
  const canTemplates = usePermission('template:view');
  const templates = useTemplates(canTemplates);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [params, setParams] = useState<string[]>([]);
  const [attaching, setAttaching] = useState(false);

  const list = templates.data ?? [];
  const quick = list.filter((x) => x.kind === 'QUICK_REPLY');
  const bank = list.find((x) => x.kind === 'BANK_DETAILS');
  const choosable = list.filter(
    (x) => x.kind === 'MESSAGE' || (x.kind === 'PROVIDER' && x.providerStatus === 'APPROVED'),
  );
  const chosen = list.find((x) => x.id === templateId);

  async function post(payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // one key per click: a double click or a retry after a lost answer sends once
      await api.post(`/conversations/${c.id}/messages`, payload, {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      setNotice(t('sent'));
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendText() {
    if (!body.trim()) return;
    if (await post({ body: body.trim() })) setBody('');
  }
  async function sendTemplate(template: TemplateView, parameters: string[] = []) {
    const ok = await post({
      templateId: template.id,
      ...(parameters.length ? { parameters } : {}),
    });
    if (ok) {
      setTemplateId('');
      setParams([]);
    }
  }
  async function sendAttachment(choice: AttachmentChoice) {
    const ok = await post({
      ...(choice.caption ? { body: choice.caption } : {}),
      attachments: [{ type: choice.type, id: choice.id }],
    });
    if (ok) setAttaching(false);
    return ok;
  }

  if (!canReply) return null;
  const freeform = c.canSendFreeform;

  return (
    <form
      aria-label={t('label')}
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void sendText();
      }}
    >
      {!freeform ? <Alert tone="info">{t('windowClosed')}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      {notice && !error ? <Alert tone="success">{notice}</Alert> : null}

      {freeform && quick.length + (bank ? 1 : 0) > 0 ? (
        <div role="group" aria-label={t('quickReplies')} className="flex flex-wrap gap-2">
          {quick.map((q) => (
            <Button
              key={q.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void sendTemplate(q)}
            >
              {q.name}
            </Button>
          ))}
          {bank ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void sendTemplate(bank)}
            >
              {t('bankDetails')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {freeform ? (
        <>
          <Textarea
            aria-label={t('label')}
            placeholder={t('placeholder')}
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy || !body.trim()}>
              {busy ? t('sending') : t('send')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setAttaching(true)}>
              {t('attach')}
            </Button>
          </div>
        </>
      ) : null}

      {canTemplates ? (
        <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-2">
          <Select
            aria-label={t('templates')}
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setParams([]);
            }}
          >
            <option value="">{t('chooseTemplate')}</option>
            {choosable.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
          {!freeform && choosable.length === 0 ? (
            <p className="text-sm text-neutral-600">{t('noTemplates')}</p>
          ) : null}
          {chosen ? (
            <>
              <p className="whitespace-pre-wrap text-sm text-neutral-700">{chosen.body}</p>
              {chosen.kind === 'PROVIDER'
                ? numbered(chosen).map((name, i) => (
                    <Input
                      key={name}
                      aria-label={t('parameter', { name })}
                      placeholder={t('parameter', { name })}
                      value={params[i] ?? ''}
                      onChange={(e) =>
                        setParams((p) => Object.assign([...p], { [i]: e.target.value }))
                      }
                    />
                  ))
                : null}
              <Button
                type="button"
                disabled={busy}
                onClick={() => void sendTemplate(chosen, chosen.kind === 'PROVIDER' ? params : [])}
              >
                {t('sendTemplate')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      <AttachDialog
        open={attaching}
        onClose={() => setAttaching(false)}
        conversation={c}
        busy={busy}
        error={error}
        onSend={sendAttachment}
      />
    </form>
  );
}
