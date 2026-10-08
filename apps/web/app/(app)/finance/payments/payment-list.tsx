'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DataTable, type Column, type FilterDefinition } from '@/components/data-table/data-table';
import { PaymentActions } from '@/components/finance/payment-actions';
import { PAYMENT_STATUS_COLORS } from '@/components/finance/payments-panel';
import { RecordPaymentDialog } from '@/components/finance/record-payment-dialog';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDate, formatMoney } from '@/lib/format';
import {
  usePaymentMethods,
  type PaymentStatus,
  type PaymentType,
  type PaymentView,
} from '@/lib/hooks/use-finance';
import { usePermission, useWorkspaceLocale } from '@/lib/session';

const STATUSES: PaymentStatus[] = ['PENDING_VERIFICATION', 'CONFIRMED', 'REJECTED', 'VOIDED'];
const TYPES: PaymentType[] = ['ORDER_PAYMENT', 'DEPOSIT', 'ADVANCE', 'CREDIT_APPLIED', 'REFUND'];

export function PaymentList() {
  const t = useTranslations('finance.payments');
  const ts = useTranslations('finance.status');
  const tt = useTranslations('finance.type');
  const locale = useWorkspaceLocale();
  const canRecord = usePermission('payment:create');
  const methods = usePaymentMethods().data ?? [];
  const [advance, setAdvance] = useState(false);

  const columns: Array<Column<PaymentView>> = [
    {
      key: 'number',
      header: t('number'),
      cell: (p) => <span className="font-medium">{p.paymentNumber}</span>,
    },
    { key: 'type', header: t('type'), cell: (p) => tt(p.type) },
    {
      key: 'order',
      header: t('order'),
      cell: (p) =>
        p.orderId ? (
          <Link className="underline" href={`/orders/${p.orderId}`}>
            {t('openOrder')}
          </Link>
        ) : (
          ''
        ),
    },
    {
      key: 'method',
      header: t('method'),
      cell: (p) => methods.find((m) => m.id === p.paymentMethodId)?.name ?? '',
    },
    {
      key: 'amount',
      header: t('amount'),
      className: 'text-right',
      cell: (p) => <span className="tabular-nums">{formatMoney(p.amount, locale)}</span>,
    },
    {
      key: 'date',
      header: t('date'),
      sortKey: 'paidAt',
      cell: (p) => formatDate(p.paidAt, locale),
    },
    {
      key: 'status',
      header: t('statusLabel'),
      cell: (p) => <StatusBadge label={ts(p.status)} color={PAYMENT_STATUS_COLORS[p.status]} />,
    },
    { key: 'actions', header: t('actions'), cell: (p) => <PaymentActions payment={p} /> },
  ];
  const filters: FilterDefinition[] = [
    {
      key: 'status',
      label: t('filterStatus'),
      options: STATUSES.map((s) => ({ value: s, label: ts(s) })),
    },
    {
      key: 'type',
      label: t('filterType'),
      options: TYPES.map((s) => ({ value: s, label: tt(s) })),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {canRecord ? (
          <Button type="button" onClick={() => setAdvance(true)}>
            {t('recordAdvance')}
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-neutral-600">{t('hint')}</p>
      <DataTable<PaymentView>
        queryKey="payments"
        endpoint="/payments"
        caption={t('caption')}
        columns={columns}
        rowKey={(p) => p.id}
        filters={filters}
        defaultSort="paidAt:desc"
        emptyTitle={t('empty')}
        emptyDescription={t('emptyDescription')}
      />
      {advance ? <RecordPaymentDialog open onClose={() => setAdvance(false)} /> : null}
    </div>
  );
}
