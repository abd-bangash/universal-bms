'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { usePermission } from '@/lib/session';
import { useTerminology } from '@/lib/terminology';
import { LeadBoard } from './lead-board';
import { LeadList } from './lead-list';

/** The leads page: board or list over the same data. */
export function LeadsHome() {
  const t = useTranslations('leads');
  const term = useTerminology();
  const canCreate = usePermission('lead:create');
  const [view, setView] = useState<'board' | 'list'>('board');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{term('lead', 'plural')}</h1>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label={t('viewSwitch')}
            className="flex overflow-hidden rounded-md border border-neutral-300"
          >
            {(['board', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={
                  view === v
                    ? 'bg-neutral-900 px-3 py-1.5 text-sm text-white'
                    : 'bg-white px-3 py-1.5 text-sm'
                }
              >
                {t(v)}
              </button>
            ))}
          </div>
          {canCreate ? (
            <Button asChild>
              <Link href="/leads/new">{t('new', { lead: term('lead').toLowerCase() })}</Link>
            </Button>
          ) : null}
        </div>
      </div>
      {view === 'board' ? <LeadBoard /> : <LeadList />}
    </div>
  );
}
