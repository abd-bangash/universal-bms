'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DataTable, type Column, type FilterDefinition } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import type { SupplierView } from '@/lib/hooks/use-purchasing';
import { usePermission } from '@/lib/session';
import { useTerminology } from '@/lib/terminology';
import { SupplierDialog } from './supplier-dialog';

export function SupplierList() {
  const t = useTranslations('purchasing.supplier');
  const term = useTerminology();
  const canCreate = usePermission('supplier:create');
  const [adding, setAdding] = useState(false);

  const columns: Array<Column<SupplierView>> = [
    {
      key: 'name',
      header: t('name'),
      sortKey: 'name',
      cell: (s) => (
        <Link
          href={`/purchasing/suppliers/${s.id}`}
          className="font-medium underline-offset-2 hover:underline"
        >
          {s.name}
        </Link>
      ),
    },
    { key: 'contact', header: t('contactName'), cell: (s) => s.contactName ?? '' },
    { key: 'phone', header: t('phone'), cell: (s) => s.phone ?? '' },
    { key: 'email', header: t('email'), cell: (s) => <span className="break-all">{s.email}</span> },
    {
      key: 'status',
      header: t('status'),
      cell: (s) => (
        <StatusBadge
          label={t(`statusLabels.${s.status}`)}
          color={s.status === 'ACTIVE' ? '#16a34a' : '#78350f'}
        />
      ),
    },
  ];
  const filters: FilterDefinition[] = [
    {
      key: 'status',
      label: t('filterStatus'),
      options: (['ACTIVE', 'ARCHIVED'] as const).map((s) => ({
        value: s,
        label: t(`statusLabels.${s}`),
      })),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{term('supplier', 'plural')}</h1>
        {canCreate ? (
          <Button type="button" onClick={() => setAdding(true)}>
            {t('new', { supplier: term('supplier').toLowerCase() })}
          </Button>
        ) : null}
      </div>
      <DataTable<SupplierView>
        queryKey="suppliers"
        endpoint="/suppliers"
        caption={t('caption')}
        columns={columns}
        rowKey={(s) => s.id}
        filters={filters}
        defaultSort="name:asc"
        emptyTitle={t('empty')}
        emptyDescription={t('emptyDescription')}
      />
      {adding ? <SupplierDialog open onClose={() => setAdding(false)} /> : null}
    </div>
  );
}
