'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { useErrorMessage } from '@/lib/error-message';
import { useReportCatalogue } from '@/lib/hooks/use-reports';

/** The reports this person may run (Requirement 19.2, 44.1). */
export function ReportCatalogue() {
  const t = useTranslations('reports');
  const message = useErrorMessage();
  const catalogue = useReportCatalogue();
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {catalogue.isError ? <Alert>{message(catalogue.error)}</Alert> : null}
      {catalogue.isPending ? <p role="status">{t('loading')}</p> : null}
      {catalogue.data && catalogue.data.length === 0 ? <p>{t('none')}</p> : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(catalogue.data ?? []).map((r) => (
          <li key={r.key}>
            <Card>
              <Link href={`/reports/${r.key}`} className="font-medium underline">
                {r.title}
              </Link>
              <p className="mt-1 text-sm text-neutral-600">{r.description}</p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
