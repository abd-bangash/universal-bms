'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import {
  NOTIFICATIONS_KEY,
  useNotificationList,
  useUnreadNotifications,
} from '@/lib/hooks/use-notifications';
import { useWorkspaceLocale } from '@/lib/session';
import { cn } from '@/lib/utils';

/** The bell in the header: the unread count (asked again every 30 seconds) and the latest notifications. */
export function NotificationBell() {
  const t = useTranslations('notifications');
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const count = useUnreadNotifications();
  const list = useNotificationList(open);
  const root = useRef<HTMLDivElement>(null);
  const unread = count.data ?? 0;

  // Escape or a click elsewhere closes the list.
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') setOpen(false);
      } else if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  async function read(id: string) {
    try {
      await api.post(`/notifications/${id}/read`);
      await refresh();
    } catch {
      // the link still works; the count catches up on the next refresh
    }
  }
  async function readAll() {
    try {
      await api.post('/notifications/read-all');
      await refresh();
    } catch {
      // nothing to show: the list stays as it was
    }
  }

  return (
    <div ref={root} className="relative ml-auto sm:ml-0">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls="notification-list"
        aria-label={unread > 0 ? t('bellUnread', { count: unread }) : t('bell')}
        title={t('bell')}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="ml-1 rounded-full bg-red-600 px-1.5 text-xs font-medium text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </Button>
      {open ? (
        <section
          id="notification-list"
          aria-label={t('title')}
          className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-md border border-neutral-200 bg-white p-2 shadow-lg"
        >
          <div className="flex items-center justify-between px-1 pb-2">
            <h2 className="text-sm font-medium">{t('title')}</h2>
            <button
              type="button"
              className="text-xs underline disabled:no-underline disabled:opacity-50"
              disabled={unread === 0}
              onClick={() => void readAll()}
            >
              {t('readAll')}
            </button>
          </div>
          {list.isPending ? (
            <p role="status" className="px-1 text-sm">
              {t('loading')}
            </p>
          ) : null}
          {list.isError ? (
            <p role="alert" className="px-1 text-sm">
              {t('failed')}
            </p>
          ) : null}
          {list.data && list.data.length === 0 ? (
            <p className="px-1 text-sm text-neutral-600">{t('empty')}</p>
          ) : null}
          <ul className="max-h-96 divide-y overflow-y-auto">
            {(list.data ?? []).map((n) => {
              const inner = (
                <>
                  <span className={cn('block text-sm', !n.read && 'font-semibold')}>
                    {!n.read ? <span className="sr-only">{t('unread')}: </span> : null}
                    {n.title}
                  </span>
                  {n.body ? (
                    <span className="block truncate text-xs text-neutral-600">{n.body}</span>
                  ) : null}
                  <span className="block text-xs text-neutral-500">
                    {formatDateTime(n.createdAt, locale)}
                  </span>
                </>
              );
              return (
                <li key={n.id}>
                  {n.href ? (
                    <Link
                      href={n.href}
                      className="block px-1 py-2 hover:bg-neutral-50"
                      onClick={() => {
                        void read(n.id);
                        setOpen(false);
                      }}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="block w-full px-1 py-2 text-left hover:bg-neutral-50"
                      onClick={() => void read(n.id)}
                    >
                      {inner}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
