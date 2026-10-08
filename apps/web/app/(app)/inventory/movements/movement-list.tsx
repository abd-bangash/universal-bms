'use client';

import { useTranslations } from 'next-intl';
import { DataTable, type Column, type FilterDefinition } from '@/components/data-table/data-table';
import { formatDateTime } from '@/lib/format';
import { MOVEMENT_TYPES, useLocations, type MovementView } from '@/lib/hooks/use-inventory';
import { useWorkspaceLocale } from '@/lib/session';

/** The stock ledger, newest first. Nothing in it is ever edited (Requirement 7.1). */
export function MovementList() {
  const t = useTranslations('inventory.movements');
  const tt = useTranslations('inventory.movementType');
  const locale = useWorkspaceLocale();
  const locations = useLocations(true).data ?? [];
  const columns: Array<Column<MovementView>> = [
    { key: 'when', header: t('when'), cell: (m) => formatDateTime(m.createdAt, locale) },
    {
      key: 'item',
      header: t('item'),
      cell: (m) => (
        <div>
          <p className="font-medium">{m.productName}</p>
          <p className="text-xs text-neutral-600">{m.sku}</p>
        </div>
      ),
    },
    { key: 'type', header: t('type'), cell: (m) => tt(m.movementType) },
    {
      key: 'delta',
      header: t('quantity'),
      className: 'text-right',
      cell: (m) => (
        <span className={`tabular-nums ${Number(m.quantityDelta) < 0 ? 'text-red-700' : ''}`}>
          {Number(m.quantityDelta) > 0 ? '+' : ''}
          {Number(m.quantityDelta)}
        </span>
      ),
    },
    {
      key: 'location',
      header: t('location'),
      cell: (m) => locations.find((l) => l.id === m.locationId)?.name ?? '',
    },
    { key: 'note', header: t('note'), cell: (m) => m.note ?? '' },
  ];
  const filters: FilterDefinition[] = [
    {
      key: 'type',
      label: t('filterType'),
      options: MOVEMENT_TYPES.map((x) => ({ value: x, label: tt(x) })),
    },
    {
      key: 'locationId',
      label: t('filterLocation'),
      options: locations.map((l) => ({ value: l.id, label: l.name })),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <DataTable<MovementView>
        queryKey="movements"
        endpoint="/inventory/movements"
        caption={t('caption')}
        columns={columns}
        rowKey={(m) => m.id}
        filters={filters}
        searchable={false}
        emptyTitle={t('empty')}
        emptyDescription={t('emptyDescription')}
      />
    </div>
  );
}
