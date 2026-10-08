'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { useErrorMessage } from '@/lib/error-message';
import { formatDate, formatMoney } from '@/lib/format';
import { useDashboard } from '@/lib/hooks/use-reports';
import { useSession, useWorkspaceLocale } from '@/lib/session';
import { useTerminology } from '@/lib/terminology';

/** Home: the indicators this person may see, alerts that need attention, and their own tasks (Requirement 19.1). */
export default function HomePage() {
  const t = useTranslations('home');
  const term = useTerminology();
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const { user, workspace } = useSession();
  const dashboard = useDashboard();
  const d = dashboard.data;

  const alerts: Array<{ key: string; text: string; href: string }> = [];
  if (d?.lowStock && d.lowStock.count > 0) {
    alerts.push({
      key: 'stock',
      text: t('lowStock', { count: d.lowStock.count }),
      href: '/reports/low-stock',
    });
  }
  if (d?.myTasks && d.myTasks.overdue > 0) {
    alerts.push({
      key: 'tasks',
      text: t('overdueTasks', { count: d.myTasks.overdue }),
      href: '/tasks',
    });
  }

  const money = (title: string, figure: { orders: number; total: string } | undefined) =>
    figure ? (
      <Card key={title}>
        <p className="text-sm text-neutral-600">{title}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {formatMoney(figure.total, locale)}
        </p>
        <p className="text-sm text-neutral-600">{t('orders', { count: figure.orders })}</p>
      </Card>
    ) : null;

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-neutral-700">
          {t('welcome', { name: user.firstName })} · {t('workspace', { workspace: workspace.name })}
        </p>
      </div>

      {dashboard.isError ? <Alert>{message(dashboard.error)}</Alert> : null}
      {dashboard.isPending ? <p role="status">{t('loading')}</p> : null}

      {alerts.length > 0 ? (
        <section aria-label={t('alerts')} className="flex flex-col gap-2">
          {alerts.map((a) => (
            <Alert key={a.key} tone="info">
              <Link href={a.href} className="underline">
                {a.text}
              </Link>
            </Alert>
          ))}
        </section>
      ) : null}

      {d ? (
        <>
          <section
            aria-label={t('indicators')}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {money(t('salesToday'), d.salesToday)}
            {money(t('salesWeek'), d.salesWeek)}
            {money(t('salesMonth'), d.salesMonth)}
            {d.outstandingBalances ? (
              <Card>
                <p className="text-sm text-neutral-600">{t('outstanding')}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {formatMoney(d.outstandingBalances.total, locale)}
                </p>
                <p className="text-sm text-neutral-600">
                  <Link href="/reports/customer-balances" className="underline">
                    {t('customersOwing', {
                      count: d.outstandingBalances.customers,
                      customers: term('customer', 'plural').toLowerCase(),
                    })}
                  </Link>
                </p>
              </Card>
            ) : null}
            {d.pendingCommissions ? (
              <Card>
                <p className="text-sm text-neutral-600">{t('pendingCommissions')}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {d.pendingCommissions.amount !== undefined
                    ? formatMoney(d.pendingCommissions.amount, locale)
                    : d.pendingCommissions.count}
                </p>
                <p className="text-sm text-neutral-600">
                  <Link href="/staff/commissions" className="underline">
                    {t('commissionsWaiting', { count: d.pendingCommissions.count })}
                  </Link>
                </p>
              </Card>
            ) : null}
            {d.lowStock ? (
              <Card>
                <p className="text-sm text-neutral-600">{t('lowStockTitle')}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{d.lowStock.count}</p>
                <p className="text-sm text-neutral-600">
                  <Link href="/reports/low-stock" className="underline">
                    {t('lowStock', { count: d.lowStock.count })}
                  </Link>
                </p>
              </Card>
            ) : null}
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            {d.openOrders ? (
              <Card>
                <h2 className="font-medium">
                  {t('openOrders', { orders: term('order', 'plural').toLowerCase() })}
                </h2>
                {d.openOrders.length === 0 ? (
                  <p className="mt-1 text-sm text-neutral-600">{t('noneOpen')}</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1 text-sm">
                    {d.openOrders.map((o) => (
                      <li key={o.status} className="flex justify-between gap-3">
                        <Link href={`/orders?status=${o.status}`} className="underline">
                          {o.label}
                        </Link>
                        <span className="tabular-nums">{o.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ) : null}
            {d.leadFunnel ? (
              <Card>
                <h2 className="font-medium">
                  {t('leadFunnel', { leads: term('lead', 'plural').toLowerCase() })}
                </h2>
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {d.leadFunnel.map((l) => (
                    <li key={l.stage} className="flex justify-between gap-3">
                      <span>{l.label}</span>
                      <span className="tabular-nums">{l.count}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            {d.myTasks ? (
              <Card>
                <h2 className="font-medium">{t('myTasks')}</h2>
                <p className="mt-1 text-sm text-neutral-600">
                  {t('taskCounts', { overdue: d.myTasks.overdue, today: d.myTasks.today })}
                </p>
                {d.myTasks.items.length === 0 ? (
                  <p className="mt-2 text-sm">{t('noTasks')}</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1 text-sm">
                    {d.myTasks.items.map((task) => (
                      <li key={task.id} className="flex justify-between gap-3">
                        <Link href="/tasks" className="underline">
                          {task.title}
                        </Link>
                        {task.dueAt ? (
                          <time dateTime={task.dueAt} className="text-neutral-600">
                            {formatDate(task.dueAt, locale)}
                          </time>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
