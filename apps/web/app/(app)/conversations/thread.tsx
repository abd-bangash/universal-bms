'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { SignedImage } from '@/components/forms/signed-image';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { useStaffQuery } from '@/lib/hooks/use-crm';
import {
  conversationTitle,
  useConversation,
  useMessages,
  type ConversationView,
  type DeliveryStatus,
  type MessageView,
} from '@/lib/hooks/use-conversations';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Composer } from './composer';
import { AiPanel } from './ai-panel';
import { ContactPanel } from './contact-panel';

const TICKS: Record<DeliveryStatus, string> = {
  QUEUED: '…',
  SENT: '✓',
  DELIVERED: '✓✓',
  READ: '✓✓',
  FAILED: '!',
  RECEIVED: '',
};

export function Thread({ id }: { id: string }) {
  const t = useTranslations('conversations');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const conversation = useConversation(id);
  const messages = useMessages(id);
  const markedFor = useRef<string | null>(null);

  // Opening a conversation reads it; the unread badge in the list clears.
  const unread = conversation.data?.unreadCount ?? 0;
  useEffect(() => {
    if (unread > 0 && markedFor.current !== `${id}:${unread}`) {
      markedFor.current = `${id}:${unread}`;
      void api
        .post(`/conversations/${id}/read`)
        .then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] }))
        .catch(() => undefined);
    }
  }, [id, unread, queryClient]);

  if (conversation.isError) return <Alert>{message(conversation.error)}</Alert>;
  if (!conversation.data) return <p role="status">{t('loading')}</p>;
  const c = conversation.data;

  // The API pages newest first; show the oldest of what has been loaded at the top.
  const ordered = (messages.data?.pages.flatMap((p) => p.items) ?? []).slice().reverse();

  return (
    <div className="flex flex-col gap-3">
      <Header conversation={c} />
      <div className="grid gap-3 lg:grid-cols-[1fr_18rem]">
        <div className="flex min-w-0 flex-col gap-3">
          {messages.isError ? <Alert>{message(messages.error)}</Alert> : null}
          {messages.hasNextPage ? (
            <Button variant="outline" size="sm" onClick={() => void messages.fetchNextPage()}>
              {t('thread.olderLoad')}
            </Button>
          ) : null}
          <ol
            aria-label={t('thread.label')}
            className="flex max-h-[60vh] min-h-40 flex-col gap-2 overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 p-3"
          >
            {ordered.length === 0 && !messages.isPending ? (
              <li className="text-sm text-neutral-600">{t('thread.empty')}</li>
            ) : null}
            {ordered.map((m) => (
              <li
                key={m.id}
                className={cn('flex', m.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start')}
              >
                <Bubble message={m} />
              </li>
            ))}
          </ol>
          <Composer conversation={c} />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <ContactPanel conversation={c} />
          <AiPanel conversation={c} />
        </div>
      </div>
    </div>
  );
}

function Header({ conversation: c }: { conversation: ConversationView }) {
  const t = useTranslations('conversations');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const canAssign = usePermission('conversation:assign');
  const canReply = usePermission('conversation:reply');
  const canAutomate = usePermission('automation:configure');
  const canAi = usePermission('ai:control');
  const staff = useStaffQuery(canAssign);
  const [error, setError] = useState<string | null>(null);

  async function change(patch: Record<string, unknown>) {
    setError(null);
    try {
      await api.patch(`/conversations/${c.id}`, patch);
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Link href="/conversations" className="text-sm underline md:hidden">
          {t('back')}
        </Link>
        <h2 className="min-w-0 truncate text-lg font-semibold">{conversationTitle(c)}</h2>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Select
          aria-label={t('header.status')}
          className="w-auto"
          value={c.status}
          disabled={!canReply}
          onChange={(e) => void change({ status: e.target.value })}
        >
          {(['OPEN', 'PENDING', 'CLOSED'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
        {canAssign ? (
          <Select
            aria-label={t('header.assignee')}
            className="w-auto"
            value={c.assignedToId ?? ''}
            onChange={(e) => void change({ assignedToId: e.target.value || null })}
          >
            <option value="">{t('header.unassigned')}</option>
            {(staff.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName}
              </option>
            ))}
          </Select>
        ) : (
          <span>{c.assignedToName ?? t('header.unassigned')}</span>
        )}
        {c.optedOut ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">
            {t('header.optedOut')}
          </span>
        ) : null}
        {!c.automationActive ? (
          <>
            <span className="text-neutral-600">{t('header.automationOff')}</span>
            {canAutomate ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void change({ automationActive: true })}
              >
                {t('header.handBack')}
              </Button>
            ) : null}
          </>
        ) : null}
        {canAi ? (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={c.aiEnabled}
              aria-label={t('header.aiToggle')}
              onChange={(e) => void change({ aiEnabled: e.target.checked })}
            />
            {c.aiEnabled ? t('header.aiOn') : t('header.aiOff')}
          </label>
        ) : null}
      </div>
    </header>
  );
}

function Bubble({ message: m }: { message: MessageView }) {
  const t = useTranslations('conversations.thread');
  const d = useTranslations('conversations.delivery');
  const locale = useWorkspaceLocale();
  const outbound = m.direction === 'OUTBOUND';
  const location = m.channelMeta?.location;
  return (
    <div
      className={cn(
        'flex max-w-[85%] flex-col gap-1 rounded-lg px-3 py-2 text-sm shadow-sm',
        outbound ? 'bg-neutral-900 text-white' : 'bg-white',
      )}
    >
      {outbound && m.senderName ? (
        <span className="text-xs opacity-70">{t('sentBy', { name: m.senderName })}</span>
      ) : null}
      {m.attachments.map((a) => (
        <Attachment key={a.fileId} attachment={a} />
      ))}
      {location ? (
        <a
          className="underline"
          href={`https://www.google.com/maps?q=${location.latitude},${location.longitude}`}
          target="_blank"
          rel="noreferrer"
        >
          {location.name ?? t('location')} · {t('viewMap')}
        </a>
      ) : null}
      {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
      {!m.body && m.attachments.length === 0 && !location ? (
        <p className="italic opacity-70">{t('unsupported')}</p>
      ) : null}
      <span className="flex items-center justify-end gap-2 text-xs opacity-70">
        <time dateTime={m.providerTimestamp}>{formatDateTime(m.providerTimestamp, locale)}</time>
        {outbound ? (
          <span
            role="img"
            aria-label={d(m.status)}
            title={
              m.status === 'FAILED' && m.failureReason
                ? `${d('FAILED')}: ${m.failureReason}`
                : d(m.status)
            }
            className={cn(
              m.status === 'READ' && 'text-sky-300',
              m.status === 'FAILED' && 'font-bold text-red-300',
            )}
          >
            {TICKS[m.status]}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** A picture is shown in place; any other file opens through a short-lived link. */
function Attachment({ attachment }: { attachment: MessageView['attachments'][number] }) {
  const t = useTranslations('conversations.thread');
  if (attachment.mime.startsWith('image/')) {
    return (
      <SignedImage
        fileId={attachment.fileId}
        alt={attachment.name}
        className="h-40 w-40 max-w-full"
      />
    );
  }
  async function open() {
    const { url } = await api.get<{ url: string }>(`/files/${attachment.fileId}/url`);
    window.open(url, '_blank', 'noopener');
  }
  return (
    <button type="button" className="text-left underline" onClick={() => void open()}>
      {t('openFile', { name: attachment.name })}
    </button>
  );
}
