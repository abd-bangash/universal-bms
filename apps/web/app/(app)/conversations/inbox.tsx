'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { useErrorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import {
  conversationTitle,
  useConversations,
  type ConversationView,
  type InboxFilters,
} from '@/lib/hooks/use-conversations';
import { useWorkspaceLocale } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Thread } from './thread';

/** Two panes on a wide screen; on a phone one at a time: the list, or the conversation that was opened. */
export function Inbox() {
  const t = useTranslations('conversations');
  const params = useSearchParams();
  const openId = params.get('open');
  const [filters, setFilters] = useState<InboxFilters>({ status: '', assigned: '' });
  const [text, setText] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => ({ ...f, q: text })), 300);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <div className="grid gap-4 md:grid-cols-[22rem_1fr]">
        <section
          aria-label={t('list.label')}
          className={cn('flex min-w-0 flex-col gap-3', openId ? 'hidden md:flex' : 'flex')}
        >
          <Filters filters={filters} onChange={setFilters} text={text} onText={setText} />
          <List filters={filters} openId={openId} />
        </section>
        <section className={cn('min-w-0', openId ? 'block' : 'hidden md:block')}>
          {openId ? (
            <Thread id={openId} />
          ) : (
            <p className="rounded-md border border-dashed border-neutral-300 p-6 text-sm text-neutral-600">
              {t('select')}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function Filters({
  filters,
  onChange,
  text,
  onText,
}: {
  filters: InboxFilters;
  onChange: (f: InboxFilters) => void;
  text: string;
  onText: (t: string) => void;
}) {
  const t = useTranslations('conversations.filters');
  const s = useTranslations('conversations.status');
  return (
    <form
      role="search"
      aria-label={t('label')}
      className="flex flex-col gap-2"
      onSubmit={(e) => e.preventDefault()}
    >
      <Input
        type="search"
        aria-label={t('search')}
        placeholder={t('search')}
        value={text}
        onChange={(e) => onText(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <Select
          aria-label={t('status')}
          value={filters.status ?? ''}
          onChange={(e) =>
            onChange({ ...filters, status: e.target.value as InboxFilters['status'] })
          }
        >
          <option value="">{t('allStatuses')}</option>
          {(['OPEN', 'PENDING', 'CLOSED'] as const).map((v) => (
            <option key={v} value={v}>
              {s(v)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('assigned')}
          value={filters.assigned ?? ''}
          onChange={(e) =>
            onChange({ ...filters, assigned: e.target.value as InboxFilters['assigned'] })
          }
        >
          <option value="">{t('anyone')}</option>
          <option value="me">{t('me')}</option>
          <option value="none">{t('none')}</option>
        </Select>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(filters.unread)}
            onChange={(e) => onChange({ ...filters, unread: e.target.checked })}
          />
          {t('unread')}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(filters.needsHuman)}
            onChange={(e) => onChange({ ...filters, needsHuman: e.target.checked })}
          />
          {t('needsHuman')}
        </label>
      </div>
    </form>
  );
}

function List({ filters, openId }: { filters: InboxFilters; openId: string | null }) {
  const t = useTranslations('conversations');
  const message = useErrorMessage();
  const query = useConversations(filters);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="flex flex-col gap-2">
      {query.isError ? <Alert>{message(query.error)}</Alert> : null}
      {query.isPending ? <p role="status">{t('loading')}</p> : null}
      {query.data && items.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('empty')}</p>
      ) : null}
      <ul className="divide-y rounded-md border border-neutral-200">
        {items.map((c) => (
          <li key={c.id}>
            <Row conversation={c} active={c.id === openId} />
          </li>
        ))}
      </ul>
      {query.hasNextPage ? (
        <Button
          variant="outline"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {t('list.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}

function Row({ conversation: c, active }: { conversation: ConversationView; active: boolean }) {
  const t = useTranslations('conversations');
  const locale = useWorkspaceLocale();
  const title = conversationTitle(c);
  return (
    <Link
      href={`/conversations?open=${c.id}`}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex flex-col gap-1 px-3 py-3 hover:bg-neutral-50',
        active && 'bg-neutral-100',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className={cn('truncate', c.unreadCount > 0 ? 'font-semibold' : 'font-medium')}>
          {title}
        </span>
        <span className="shrink-0 text-xs text-neutral-500">
          {formatDateTime(c.lastMessageAt, locale)}
        </span>
      </span>
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-sm text-neutral-600">
          {c.lastMessageDirection === 'OUTBOUND' ? t('list.you') : ''}
          {c.lastMessagePreview ?? t('list.noMessages')}
        </span>
        {c.unreadCount > 0 ? (
          <span
            aria-label={t('list.unread', { count: c.unreadCount })}
            className="shrink-0 rounded-full bg-neutral-900 px-2 text-xs font-medium text-white"
          >
            {c.unreadCount}
          </span>
        ) : null}
      </span>
      <span className="flex flex-wrap gap-2 text-xs text-neutral-500">
        <span>{t(`status.${c.status}`)}</span>
        <span>{c.assignedToName ?? t('list.unassigned')}</span>
        {c.needsHuman ? (
          <span className="font-medium text-amber-700">{t('list.needsHuman')}</span>
        ) : null}
      </span>
    </Link>
  );
}
