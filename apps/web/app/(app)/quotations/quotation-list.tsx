'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DataTable, type Column, type FilterDefinition } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDate, formatMoney } from '@/lib/format';
import type { QuotationStatus, QuotationView } from '@/lib/hooks/use-sales';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { useTerminology } from '@/lib/terminology';

export const QUOTATION_STATUSES: QuotationStatus[] = [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CONVERTED',
];
export const STATUS_COLORS: Record<QuotationStatus, string> = {
  DRAFT: '#64748b',
  SENT: '#3b82f6',
  ACCEPTED: '#16a34a',
  REJECTED: '#dc2626',
  EXPIRED: '#a3a3a3',
  CONVERTED: '#8b5cf6',
};

export function QuotationList() {
  const t = useTranslations('sales.quotation');
  const ts = useTranslations('sales.quotation.status');
  const term = useTerminology();
  const locale = useWorkspaceLocale();
  const canCreate = usePermission('quotation:create');

  const columns: Array<Column<QuotationView>> = [
    {
      key: 'number',
      header: t('number'),
      cell: (q) => (
        <Link
          href={`/quotations/${q.id}`}
          className="font-medium underline-offset-2 hover:underline"
        >
          {q.quotationNumber}
        </Link>
      ),
    },
    {
      key: 'status',
      header: t('statusLabel'),
      cell: (q) => <StatusBadge label={ts(q.status)} color={STATUS_COLORS[q.status]} />,
    },
    {
      key: 'total',
      header: t('total'),
      className: 'text-right',
      cell: (q) => <span className="tabular-nums">{formatMoney(q.totalAmount, locale)}</span>,
    },
    {
      key: 'valid',
      header: t('validUntil'),
      cell: (q) => formatDate(q.validUntil, locale),
    },
    {
      key: 'created',
      header: t('created'),
      sortKey: 'createdAt',
      cell: (q) => q.createdAt.slice(0, 10),
    },
  ];
  const filters: FilterDefinition[] = [
    {
      key: 'status',
      label: t('filterStatus'),
      options: QUOTATION_STATUSES.map((s) => ({ value: s, label: ts(s) })),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{term('quotation', 'plural')}</h1>
        {canCreate ? (
          <Button asChild>
            <Link href="/quotations/new">
              {t('new', { quotation: term('quotation').toLowerCase() })}
            </Link>
          </Button>
        ) : null}
      </div>
      <DataTable<QuotationView>
        queryKey="quotations"
        endpoint="/quotations"
        caption={t('caption')}
        columns={columns}
        rowKey={(q) => q.id}
        filters={filters}
        defaultSort="createdAt:desc"
        emptyTitle={t('empty')}
        emptyDescription={t('emptyDescription')}
      />
    </div>
  );
}
