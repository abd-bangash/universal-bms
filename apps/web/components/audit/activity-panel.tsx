'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { usePermission, useWorkspaceLocale } from '@/lib/session';

interface ActivityEvent {
  id: string;
  actorUserId: string | null;
  actorType: string;
  actorRole: string | null;
  action: string;
  createdAt: string;
}

/**
 * What happened to one record, from the audit trail: who did what and when (Requirement 4.4).
 * Shown only to people who may read the audit log.
 */
export function ActivityPanel({ entityType, entityId }: { entityType: string; entityId: string }) {
  const t = useTranslations('activity');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const allowed = usePermission('audit:view');
  const activity = useInfiniteQuery({
    queryKey: ['activity', entityType, entityId],
    enabled: allowed,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.getPage<ActivityEvent>(
        '/audit/events',
        { entityType, entityId, cursor: pageParam, limit: 20 },
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
  if (!allowed) return null;
  const events = activity.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section aria-labelledby={`activity-${entityId}`} className="flex flex-col gap-3">
      <h2 id={`activity-${entityId}`} className="font-medium">
        {t('title')}
      </h2>
      {activity.isError ? <Alert>{message(activity.error)}</Alert> : null}
      {activity.isPending ? <p role="status">{t('loading')}</p> : null}
      {activity.isSuccess && events.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('empty')}</p>
      ) : null}
      <ol className="flex flex-col gap-1 border-l border-neutral-200 pl-4 text-sm">
        {events.map((e) => (
          <li key={e.id}>
            <code className="text-xs">{e.action}</code>
            <span className="ms-2 text-neutral-600">
              {e.actorUserId ? (e.actorRole ?? t('aPerson')) : t('system')}
              {' · '}
              <time dateTime={e.createdAt}>{formatDateTime(e.createdAt, locale)}</time>
            </span>
          </li>
        ))}
      </ol>
      {activity.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={activity.isFetchingNextPage}
          onClick={() => void activity.fetchNextPage()}
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </section>
  );
}
