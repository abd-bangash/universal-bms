'use client';

import { useTranslations } from 'next-intl';
import { DataTable, type Column, type FilterDefinition } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatMoney } from '@/lib/format';
import type { StockRow } from '@/lib/hooks/use-inventory';
import { useWorkspaceLocale } from '@/lib/session';

/** Every stocked variant with what is on hand, reserved and available, flagged when low or over (Requirements 7.5, 37.11). */
export function StockTable() {
  const t = useTranslations('inventory.stock');
  const locale = useWorkspaceLocale();
  const qty = (v: string) => <span className="tabular-nums">{Number(v)}</span>;
  const columns: Array<Column<StockRow>> = [
    {
      key: 'item',
      header: t('item'),
      cell: (r) => (
        <div>
          <p className="font-medium">
            {r.variantName ? `${r.productName} · ${r.variantName}` : r.productName}
          </p>
          <p className="text-xs text-neutral-600">{r.sku}</p>
        </div>
      ),
    },
    { key: 'onHand', header: t('onHand'), className: 'text-right', cell: (r) => qty(r.onHand) },
    {
      key: 'reserved',
      header: t('reserved'),
      className: 'text-right',
      cell: (r) => qty(r.reserved),
    },
    {
      key: 'available',
      header: t('available'),
      className: 'text-right',
      cell: (r) => qty(r.available),
    },
    {
      key: 'value',
      header: t('value'),
      className: 'text-right',
      cell: (r) => <span className="tabular-nums">{formatMoney(r.stockValue, locale)}</span>,
    },
    {
      key: 'flags',
      header: t('flags'),
      cell: (r) => (
        <span className="flex gap-1">
          {r.low ? <StatusBadge label={t('lowBadge')} color="#dc2626" /> : null}
          {r.overstock ? <StatusBadge label={t('overBadge')} color="#f59e0b" /> : null}
        </span>
      ),
    },
  ];
  const filters: FilterDefinition[] = [
    { key: 'low', label: t('filterLow'), options: [{ value: 'true', label: t('lowOnly') }] },
    { key: 'over', label: t('filterOver'), options: [{ value: 'true', label: t('overOnly') }] },
  ];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <DataTable<StockRow>
        queryKey="stock"
        endpoint="/inventory/stock"
        caption={t('caption')}
        columns={columns}
        rowKey={(r) => r.variantId}
        filters={filters}
        emptyTitle={t('empty')}
        emptyDescription={t('emptyDescription')}
      />
    </div>
  );
}
