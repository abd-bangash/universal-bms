'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useErrorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { useAiLogs } from '@/lib/hooks/use-ai';
import { useWorkspaceLocale } from '@/lib/session';

/** Every AI action: what was asked, of which service, what it cost and whether a person approved the result. */
export function AiLog() {
  const t = useTranslations('ai.log');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const logs = useAiLogs();
  const rows = logs.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {logs.isError ? <Alert>{message(logs.error)}</Alert> : null}
      {logs.data && rows.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('empty')}</p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr className="border-b border-neutral-200 text-neutral-500">
              <th className="py-2 pr-3 font-normal">{t('time')}</th>
              <th className="pr-3 font-normal">{t('action')}</th>
              <th className="pr-3 font-normal">{t('service')}</th>
              <th className="pr-3 font-normal">{t('tokens')}</th>
              <th className="pr-3 font-normal">{t('latency')}</th>
              <th className="pr-3 font-normal">{t('outcome')}</th>
              <th className="font-normal">{t('approved')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-neutral-100">
                <td className="py-2 pr-3">{formatDateTime(r.createdAt, locale)}</td>
                <td className="pr-3">
                  {r.actionType}
                  <span className="block text-xs text-neutral-500">{r.promptVersion}</span>
                </td>
                <td className="pr-3">
                  {r.providerName}
                  {r.modelVersion ? (
                    <span className="block text-xs text-neutral-500">{r.modelVersion}</span>
                  ) : null}
                </td>
                <td className="pr-3">{r.inputTokens + r.outputTokens}</td>
                <td className="pr-3">{r.latencyMs === null ? '' : `${r.latencyMs} ms`}</td>
                <td className="pr-3">{t(`outcomes.${r.outcome}`)}</td>
                <td>{r.humanApproved ? formatDateTime(r.approvedAt, locale) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {logs.hasNextPage ? (
        <Button variant="outline" onClick={() => void logs.fetchNextPage()}>
          {t('more')}
        </Button>
      ) : null}
    </div>
  );
}
