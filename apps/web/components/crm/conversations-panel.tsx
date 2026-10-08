'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Can, useWorkspaceLocale } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { useConversations, type ConversationView } from '@/lib/hooks/use-conversations';

/** The conversations of one customer or lead, each a link into the inbox. */
export function ConversationsPanel({
  customerId,
  leadId,
}: {
  customerId?: string;
  leadId?: string;
}) {
  return (
    <Can permission="conversation:view">
      <Panel customerId={customerId} leadId={leadId} />
    </Can>
  );
}

function Panel({ customerId, leadId }: { customerId?: string; leadId?: string }) {
  const t = useTranslations('conversations.tab');
  const s = useTranslations('conversations.status');
  const locale = useWorkspaceLocale();
  const query = useConversations({ customerId, leadId });
  const items: ConversationView[] = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section aria-labelledby="conversations-tab" className="flex flex-col gap-2">
      <h2 id="conversations-tab" className="font-medium">
        {t('title')}
      </h2>
      {query.data && items.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('none')}</p>
      ) : null}
      <ul className="divide-y rounded-md border border-neutral-200">
        {items.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate">{c.lastMessagePreview ?? c.channelType}</span>
              <span className="text-xs text-neutral-500">
                {c.channelType} · {s(c.status)} · {formatDateTime(c.lastMessageAt, locale)}
              </span>
            </span>
            <Link className="shrink-0 underline" href={`/conversations?open=${c.id}`}>
              {t('open')}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
