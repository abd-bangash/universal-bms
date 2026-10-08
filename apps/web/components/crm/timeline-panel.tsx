'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import type { TimelineEntryView } from '@/lib/hooks/use-crm';
import { useWorkspaceLocale } from '@/lib/session';

/** The chronological record of a customer or lead, newest first (Requirement 8.4). */
export function TimelinePanel({
  path,
  queryKey,
}: {
  /** `/customers/:id/timeline` or `/leads/:id/timeline` */
  path: string;
  queryKey: readonly unknown[];
}) {
  const t = useTranslations('crm.timeline');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const timeline = useInfiniteQuery({
    queryKey: ['timeline', path, ...queryKey],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.getPage<TimelineEntryView>(path, { cursor: pageParam, limit: 20 }, signal),
    getNextPageParam: (last) => last.nextCursor,
  });
  const entries = timeline.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section aria-labelledby={`${path}-timeline`} className="flex flex-col gap-3">
      <h2 id={`${path}-timeline`} className="font-medium">
        {t('title')}
      </h2>
      {timeline.isError ? <Alert>{message(timeline.error)}</Alert> : null}
      {timeline.isPending ? <p role="status">{t('loading')}</p> : null}
      {timeline.isSuccess && entries.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('empty')}</p>
      ) : null}
      <ol className="flex flex-col gap-2 border-l border-neutral-200 pl-4">
        {entries.map((entry) => (
          <li key={entry.id} className="flex flex-col text-sm">
            <span>{entry.summary}</span>
            <time dateTime={entry.occurredAt} className="text-xs text-neutral-600">
              {formatDateTime(entry.occurredAt, locale)}
            </time>
          </li>
        ))}
      </ol>
      {timeline.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={timeline.isFetchingNextPage}
          onClick={() => void timeline.fetchNextPage()}
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </section>
  );
}
