'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DataTable, type Column, type FilterDefinition } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDate, formatMoney } from '@/lib/format';
import { useActiveSuppliers, type PurchaseView } from '@/lib/hooks/use-purchasing';
import { useWorkflowStates } from '@/lib/hooks/use-sales';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { useTerminology } from '@/lib/terminology';

export function PurchaseList() {
  const t = useTranslations('purchasing.list');
  const term = useTerminology();
  const locale = useWorkspaceLocale();
  const canCreate = usePermission('purchase:create');
  const states = useWorkflowStates('PURCHASE_ORDER').data ?? [];
  const suppliers = useActiveSuppliers().data ?? [];
  const stateOf = (key: string) => states.find((s) => s.key === key);

  const columns: Array<Column<PurchaseView>> = [
    {
      key: 'number',
      header: t('number'),
      cell: (p) => (
        <Link
          href={`/purchasing/orders/${p.id}`}
          className="font-medium underline-offset-2 hover:underline"
        >
          {p.orderNumber}
        </Link>
      ),
    },
    { key: 'supplier', header: term('supplier'), cell: (p) => p.supplierName ?? '' },
    {
      key: 'status',
      header: t('status'),
      cell: (p) => (
        <StatusBadge
          label={stateOf(p.status)?.label ?? p.status}
          color={stateOf(p.status)?.color}
        />
      ),
    },
    {
      key: 'expected',
      header: t('expected'),
      cell: (p) => (p.expectedDate ? formatDate(p.expectedDate, locale) : ''),
    },
    {
      key: 'total',
      header: t('total'),
      className: 'text-right',
      cell: (p) => <span className="tabular-nums">{formatMoney(p.totalAmount, locale)}</span>,
    },
    { key: 'date', header: t('date'), sortKey: 'orderDate', cell: (p) => p.orderDate.slice(0, 10) },
  ];
  const filters: FilterDefinition[] = [
    {
      key: 'status',
      label: t('filterStatus'),
      options: states.filter((s) => s.active).map((s) => ({ value: s.key, label: s.label })),
    },
    {
      key: 'supplierId',
      label: term('supplier'),
      options: suppliers.map((s) => ({ value: s.id, label: s.name })),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{term('purchaseOrder', 'plural')}</h1>
        {canCreate ? (
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/purchasing/quick">{t('quick')}</Link>
            </Button>
            <Button asChild>
              <Link href="/purchasing/orders/new">
                {t('new', { order: term('purchaseOrder').toLowerCase() })}
              </Link>
            </Button>
          </div>
        ) : null}
      </div>
      <DataTable<PurchaseView>
        queryKey="purchases"
        endpoint="/purchases"
        caption={t('caption')}
        columns={columns}
        rowKey={(p) => p.id}
        filters={filters}
        defaultSort="orderDate:desc"
        emptyTitle={t('empty')}
        emptyDescription={t('emptyDescription')}
      />
    </div>
  );
}
