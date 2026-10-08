'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatMoney } from '@/lib/format';
import type { ReceivablesView } from '@/lib/hooks/use-finance';
import { useWorkspaceLocale } from '@/lib/session';

/** Who owes what: invoiced, paid and outstanding per customer, with the outstanding aged by order date. */
export function ReceivablesPage() {
  const t = useTranslations('finance.receivables');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const data = useQuery({
    queryKey: ['finance', 'receivables'],
    queryFn: ({ signal }) =>
      api.get<ReceivablesView>('/payments/receivables-summary', undefined, signal),
  });
  if (data.isPending) return <p role="status">…</p>;
  if (data.isError) return <Alert>{message(data.error)}</Alert>;
  const money = (v: string) => <span className="tabular-nums">{formatMoney(v, locale)}</span>;
  const { customers, totals } = data.data;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        {(['invoiced', 'paid', 'outstanding'] as const).map((k) => (
          <div key={k}>
            <dt className="text-neutral-600">{t(k)}</dt>
            <dd className="text-lg font-semibold">{money(totals[k])}</dd>
          </div>
        ))}
      </dl>
      {customers.length === 0 ? (
        <p className="text-neutral-600">{t('none')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('title')}</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 text-start">
                  {t('customer')}
                </th>
                <th scope="col" className="px-2 text-right">
                  {t('invoiced')}
                </th>
                <th scope="col" className="px-2 text-right">
                  {t('paid')}
                </th>
                <th scope="col" className="px-2 text-right">
                  {t('outstanding')}
                </th>
                <th scope="col" className="px-2 text-right">
                  {t('current')}
                </th>
                <th scope="col" className="px-2 text-right">
                  {t('days31to60')}
                </th>
                <th scope="col" className="px-2 text-right">
                  {t('days61to90')}
                </th>
                <th scope="col" className="ps-2 text-right">
                  {t('over90')}
                </th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.customerId} className="border-b">
                  <td className="py-2">
                    <Link className="underline" href={`/customers/${c.customerId}`}>
                      {c.customerName}
                    </Link>
                  </td>
                  <td className="px-2 text-right">{money(c.invoiced)}</td>
                  <td className="px-2 text-right">{money(c.paid)}</td>
                  <td className="px-2 text-right font-medium">{money(c.outstanding)}</td>
                  <td className="px-2 text-right">{money(c.ageing.current)}</td>
                  <td className="px-2 text-right">{money(c.ageing.days31to60)}</td>
                  <td className="px-2 text-right">{money(c.ageing.days61to90)}</td>
                  <td className="ps-2 text-right">{money(c.ageing.over90)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
