'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DataTable, type Column, type FilterDefinition } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatMoney } from '@/lib/format';
import { useWorkflowStates, type OrderView } from '@/lib/hooks/use-sales';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { useTerminology } from '@/lib/terminology';

export const PAYMENT_STATUSES = [
  'UNPAID',
  'DEPOSIT_PAID',
  'PARTIALLY_PAID',
  'PAID',
  'OVERPAID',
  'REFUNDED',
] as const;

export function OrderList() {
  const t = useTranslations('sales.order');
  const tp = useTranslations('sales.order.payment');
  const term = useTerminology();
  const locale = useWorkspaceLocale();
  const canCreate = usePermission('order:create');
  const states = useWorkflowStates('ORDER').data ?? [];
  const stateOf = (key: string) => states.find((s) => s.key === key);

  const columns: Array<Column<OrderView>> = [
    {
      key: 'number',
      header: t('number'),
      cell: (o) => (
        <Link href={`/orders/${o.id}`} className="font-medium underline-offset-2 hover:underline">
          {o.orderNumber}
        </Link>
      ),
    },
    {
      key: 'status',
      header: t('statusLabel'),
      cell: (o) => (
        <StatusBadge
          label={stateOf(o.status)?.label ?? o.status}
          color={stateOf(o.status)?.color}
        />
      ),
    },
    { key: 'payment', header: t('paymentLabel'), cell: (o) => tp(o.paymentStatus) },
    {
      key: 'total',
      header: t('total'),
      className: 'text-right',
      cell: (o) => <span className="tabular-nums">{formatMoney(o.totalAmount, locale)}</span>,
    },
    {
      key: 'balance',
      header: t('balance'),
      className: 'text-right',
      cell: (o) => <span className="tabular-nums">{formatMoney(o.balanceDue, locale)}</span>,
    },
    {
      key: 'date',
      header: t('date'),
      sortKey: 'orderDate',
      cell: (o) => o.orderDate.slice(0, 10),
    },
  ];
  const filters: FilterDefinition[] = [
    {
      key: 'status',
      label: t('filterStatus'),
      options: states.filter((s) => s.active).map((s) => ({ value: s.key, label: s.label })),
    },
    {
      key: 'paymentStatus',
      label: t('filterPayment'),
      options: PAYMENT_STATUSES.map((s) => ({ value: s, label: tp(s) })),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{term('order', 'plural')}</h1>
        {canCreate ? (
          <Button asChild>
            <Link href="/orders/new">{t('new', { order: term('order').toLowerCase() })}</Link>
          </Button>
        ) : null}
      </div>
      <DataTable<OrderView>
        queryKey="orders"
        endpoint="/orders"
        caption={t('caption')}
        columns={columns}
        rowKey={(o) => o.id}
        filters={filters}
        defaultSort="orderDate:desc"
        emptyTitle={t('empty')}
        emptyDescription={t('emptyDescription')}
      />
    </div>
  );
}
