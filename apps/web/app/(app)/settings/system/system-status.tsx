'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { useErrorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { useSystemStatus } from '@/lib/hooks/use-system';
import { useWorkspaceLocale } from '@/lib/session';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Owner-only: are the core services up, are the connections working, are jobs failing, is there a recent backup. */
export function SystemStatusView() {
  const t = useTranslations('settings.system');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const status = useSystemStatus();
  const data = status.data;
  const when = (iso: string | null) => (iso ? formatDateTime(iso, locale) : t('never'));
  const backupStale =
    data?.lastBackup && Date.now() - new Date(data.lastBackup.at).getTime() > DAY_MS;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-neutral-600">{t('intro')}</p>
      </div>
      {status.isError ? <Alert>{message(status.error)}</Alert> : null}
      {data ? (
        <>
          <Card className="p-4">
            <h2 className="mb-2 font-medium">{t('services')}</h2>
            <ul className="flex flex-wrap gap-4 text-sm">
              {data.services.map((s) => (
                <li key={s.name}>
                  <span className="capitalize">{s.name}</span>:{' '}
                  <span className={s.up ? 'text-green-700' : 'font-medium text-red-700'}>
                    {s.up ? t('up') : t('down')}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 font-medium">{t('integrations')}</h2>
            {data.integrations.length === 0 ? (
              <p className="text-sm text-neutral-600">{t('noIntegrations')}</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {data.integrations.map((i) => (
                  <li key={i.provider}>
                    <span className="font-medium">{i.provider}</span> — {i.status}
                    <div className="text-neutral-600">
                      {t('lastSuccess', { when: when(i.lastSuccessAt) })}
                    </div>
                    {i.lastError ? (
                      <div className="text-red-700">
                        {t('lastError', { when: when(i.lastErrorAt), error: i.lastError })}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 font-medium">{t('queues')}</h2>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('queues')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('queue')}</th>
                  <th scope="col">{t('waiting')}</th>
                  <th scope="col">{t('active')}</th>
                  <th scope="col">{t('delayed')}</th>
                  <th scope="col">{t('failed')}</th>
                </tr>
              </thead>
              <tbody>
                {data.queues.map((q) => (
                  <tr key={q.name}>
                    <th scope="row" className="font-normal">
                      {q.name}
                    </th>
                    <td>{q.waiting}</td>
                    <td>{q.active}</td>
                    <td>{q.delayed}</td>
                    <td className={q.failed > 0 ? 'font-medium text-red-700' : undefined}>
                      {q.failed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-sm">{t('deadLetters', { count: data.deadLetters })}</p>
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 font-medium">{t('backup')}</h2>
            {data.lastBackup ? (
              <>
                <p className="text-sm">
                  {t('lastBackup', { when: formatDateTime(data.lastBackup.at, locale) })}
                  {data.lastBackup.note ? ` (${data.lastBackup.note})` : ''}
                </p>
                {backupStale ? <Alert>{t('backupWarn')}</Alert> : null}
              </>
            ) : (
              <Alert>{t('noBackup')}</Alert>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
