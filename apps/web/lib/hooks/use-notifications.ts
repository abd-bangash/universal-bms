'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  createdAt: string;
}

export const NOTIFICATIONS_KEY = ['notifications'] as const;
/** The bell asks again this often (design.md, Notifications). */
export const POLL_MS = 30_000;

export function useUnreadNotifications() {
  return useQuery({
    queryKey: [...NOTIFICATIONS_KEY, 'unread-count'],
    queryFn: ({ signal }) =>
      api.get<{ count: number }>('/notifications/unread-count', undefined, signal),
    refetchInterval: POLL_MS,
    select: (r) => r.count,
  });
}

export function useNotificationList(enabled: boolean) {
  return useQuery({
    queryKey: [...NOTIFICATIONS_KEY, 'list'],
    enabled,
    queryFn: ({ signal }) => api.getPage<NotificationView>('/notifications', { limit: 20 }, signal),
    select: (page) => page.items,
  });
}
