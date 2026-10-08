'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DataTable, type Column, type FilterDefinition } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { useFieldsQuery } from '@/lib/hooks/use-catalog';
import type { CustomerView } from '@/lib/hooks/use-crm';
import { usePermission } from '@/lib/session';
import { useTerminology } from '@/lib/terminology';

export function CustomerList() {
  const t = useTranslations('customers');
  const term = useTerminology();
  const canCreate = usePermission('customer:create');
  const fields = useFieldsQuery('CUSTOMER');

  const columns: Array<Column<CustomerView>> = [
    {
      key: 'name',
      header: t('name'),
      sortKey: 'fullName',
      cell: (c) => (
        <Link
          href={`/customers/${c.id}`}
          className="font-medium underline-offset-2 hover:underline"
        >
          {c.fullName}
        </Link>
      ),
    },
    { key: 'phone', header: t('phone'), cell: (c) => c.phones[0] ?? '' },
    { key: 'email', header: t('email'), cell: (c) => <span className="break-all">{c.email}</span> },
    { key: 'tags', header: t('tags'), cell: (c) => c.tags.join(', ') },
    {
      key: 'status',
      header: t('status'),
      cell: (c) => (
        <StatusBadge
          label={t(`statusLabels.${c.status}`)}
          color={c.status === 'ACTIVE' ? '#16a34a' : '#78350f'}
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
    // Dropdown attributes become filters without code (Requirement 26.7).
    ...(fields.data ?? [])
      .filter((f) => f.active !== false && f.type === 'DROPDOWN')
      .map((f) => ({
        key: `cf.${f.key}`,
        label: f.label,
        options: (f.options ?? []).map((o) => ({ value: o.key, label: o.label })),
      })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{term('customer', 'plural')}</h1>
        {canCreate ? (
          <Button asChild>
            <Link href="/customers/new">
              {t('new', { customer: term('customer').toLowerCase() })}
            </Link>
          </Button>
        ) : null}
      </div>
      <DataTable<CustomerView>
        queryKey="customers"
        endpoint="/customers"
        caption={term('customer', 'plural')}
        columns={columns}
        rowKey={(c) => c.id}
        filters={filters}
        defaultSort="fullName:asc"
        emptyTitle={t('empty')}
        emptyDescription={canCreate ? t('emptyDescription') : undefined}
      />
    </div>
  );
}
