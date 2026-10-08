'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DataTable, type Column, type FilterDefinition } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  flattenCategories,
  useBrandsQuery,
  useCategoriesQuery,
  useFieldsQuery,
  type ProductView,
} from '@/lib/hooks/use-catalog';
import { formatMoney } from '@/lib/format';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { useTerminology } from '@/lib/terminology';

const STATUS_COLOR: Record<ProductView['status'], string> = {
  ACTIVE: '#16a34a',
  INACTIVE: '#a3a3a3',
  ARCHIVED: '#78350f',
};

export function ProductList() {
  const t = useTranslations('products');
  const term = useTerminology();
  const locale = useWorkspaceLocale();
  const canCreate = usePermission('product:create');
  const categories = useCategoriesQuery();
  const brands = useBrandsQuery();
  const fields = useFieldsQuery('PRODUCT');
  const categoryNames = new Map(
    flattenCategories(categories.data ?? []).map((c) => [c.id, c.name]),
  );

  const columns: Array<Column<ProductView>> = [
    {
      key: 'name',
      header: t('name'),
      sortKey: 'name',
      cell: (p) => (
        <Link href={`/products/${p.id}`} className="font-medium underline-offset-2 hover:underline">
          {p.name}
        </Link>
      ),
    },
    { key: 'code', header: t('code'), sortKey: 'code', cell: (p) => p.code },
    {
      key: 'category',
      header: t('category'),
      cell: (p) => (p.categoryId ? (categoryNames.get(p.categoryId) ?? '') : ''),
    },
    {
      key: 'price',
      header: t('price'),
      className: 'text-right',
      cell: (p) => <span className="tabular-nums">{formatMoney(p.basePrice, locale)}</span>,
    },
    {
      key: 'variants',
      header: t('variants'),
      className: 'text-right',
      cell: (p) => p.variants?.filter((v) => v.status !== 'ARCHIVED').length ?? 0,
    },
    {
      key: 'status',
      header: t('status'),
      cell: (p) => (
        <StatusBadge label={t(`statusLabels.${p.status}`)} color={STATUS_COLOR[p.status]} />
      ),
    },
  ];

  const filters: FilterDefinition[] = [
    {
      key: 'categoryId',
      label: t('category'),
      options: flattenCategories(categories.data ?? []).map((c) => ({
        value: c.id,
        label: `${'— '.repeat(c.depth)}${c.name}`,
      })),
    },
    {
      key: 'brandId',
      label: t('brand'),
      options: (brands.data ?? []).map((b) => ({ value: b.id, label: b.name })),
    },
    {
      key: 'status',
      label: t('status'),
      options: (['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const).map((s) => ({
        value: s,
        label: t(`statusLabels.${s}`),
      })),
    },
    // Dropdown and yes/no attributes become filters without any code (Requirement 26.7).
    ...(fields.data ?? [])
      .filter((f) => f.active !== false && (f.type === 'DROPDOWN' || f.type === 'BOOLEAN'))
      .map((f) => ({
        key: `cf.${f.key}`,
        label: f.label,
        options:
          f.type === 'BOOLEAN'
            ? [
                { value: 'true', label: t('yes') },
                { value: 'false', label: t('no') },
              ]
            : (f.options ?? []).map((o) => ({ value: o.key, label: o.label })),
      })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{term('product', 'plural')}</h1>
        {canCreate ? (
          <Button asChild>
            <Link href="/products/new">{t('new', { product: term('product') })}</Link>
          </Button>
        ) : null}
      </div>
      <DataTable<ProductView>
        queryKey="products"
        endpoint="/catalog/products"
        caption={t('caption', { products: term('product', 'plural') })}
        columns={columns}
        rowKey={(p) => p.id}
        filters={filters}
        defaultSort="name:asc"
        emptyTitle={t('empty', { products: term('product', 'plural') })}
        emptyDescription={canCreate ? t('emptyDescription') : undefined}
      />
    </div>
  );
}
