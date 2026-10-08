'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { api, type QueryParams } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** The API field to sort by; the column is sortable when given. */
  sortKey?: string;
  className?: string;
}

export interface FilterDefinition {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

export interface DataTableProps<T> {
  /** Distinguishes this list in the query cache. */
  queryKey: string;
  /** List endpoint such as `/users`; it must follow the standard pagination contract. */
  endpoint: string;
  columns: Array<Column<T>>;
  rowKey: (row: T) => string;
  searchable?: boolean;
  filters?: FilterDefinition[];
  /** `field:asc` or `field:desc`, sent as `sort` until the user picks a column. */
  defaultSort?: string;
  pageSize?: number;
  /** Fixed parameters always sent (for example a tab selection). */
  params?: QueryParams;
  emptyTitle?: string;
  emptyDescription?: string;
  caption: string;
  onRowClick?: (row: T) => void;
  toolbar?: ReactNode;
}

const SEARCH_DELAY_MS = 300;

/**
 * The standard list: search, filters, sorting, cursor pagination, and explicit loading, empty and
 * error (with retry) states (Requirement 49.4).
 */
export function DataTable<T>({
  queryKey,
  endpoint,
  columns,
  rowKey,
  searchable = true,
  filters = [],
  defaultSort,
  pageSize = 25,
  params,
  emptyTitle,
  emptyDescription,
  caption,
  onRowClick,
  toolbar,
}: DataTableProps<T>) {
  const t = useTranslations('table');
  const tCommon = useTranslations('common');
  const message = useErrorMessage();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<string | undefined>(defaultSort);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);

  useEffect(() => {
    const timer = setTimeout(() => setQ(input.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const page = cursors.length;
  const cursor = cursors[cursors.length - 1];

  // A new search, filter or sort starts again from the first page.
  useEffect(() => {
    setCursors([undefined]);
  }, [q, sort, filterValues]);

  const query = useQuery({
    queryKey: ['list', queryKey, endpoint, params, q, filterValues, sort, cursor, pageSize],
    queryFn: ({ signal }) =>
      api.getPage<T>(
        endpoint,
        { ...params, ...filterValues, q: q || undefined, sort, cursor, limit: pageSize },
        signal,
      ),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const rows = query.data?.items ?? [];
  const filtered = q !== '' || Object.values(filterValues).some(Boolean);
  const [sortField, sortDirection] = (sort ?? '').split(':');

  function toggleSort(key: string) {
    setSort(sortField === key && sortDirection === 'asc' ? `${key}:desc` : `${key}:asc`);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        {searchable ? (
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <label htmlFor={`${queryKey}-search`} className="sr-only">
              {t('searchLabel')}
            </label>
            <Input
              id={`${queryKey}-search`}
              type="search"
              value={input}
              placeholder={t('searchPlaceholder')}
              onChange={(e) => setInput(e.target.value)}
            />
          </div>
        ) : null}
        {filters.map((filter) => (
          <div key={filter.key} className="flex flex-col gap-1">
            <label htmlFor={`${queryKey}-${filter.key}`} className="text-xs text-neutral-600">
              {filter.label}
            </label>
            <Select
              id={`${queryKey}-${filter.key}`}
              value={filterValues[filter.key] ?? ''}
              onChange={(e) =>
                setFilterValues((prev) => ({ ...prev, [filter.key]: e.target.value }))
              }
            >
              <option value="">{t('filterAll')}</option>
              {filter.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        ))}
        {filtered && (filters.length > 0 || searchable) ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setInput('');
              setQ('');
              setFilterValues({});
            }}
          >
            {t('clearFilters')}
          </Button>
        ) : null}
        {toolbar}
      </div>

      {query.isError ? (
        <Alert className="flex items-center justify-between gap-2">
          <span>
            {t('errorTitle')} {message(query.error)}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            {tCommon('retry')}
          </Button>
        </Alert>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-neutral-200">
        <table className="w-full text-left text-sm" aria-busy={query.isFetching}>
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-600">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn('px-3 py-2 font-medium', column.className)}
                  aria-sort={
                    column.sortKey && sortField === column.sortKey
                      ? sortDirection === 'desc'
                        ? 'descending'
                        : 'ascending'
                      : undefined
                  }
                >
                  {column.sortKey ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 uppercase"
                      onClick={() => toggleSort(column.sortKey as string)}
                    >
                      {column.header}
                      <span aria-hidden="true">
                        {sortField === column.sortKey ? (sortDirection === 'desc' ? '▼' : '▲') : ''}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {query.isPending ? (
              <LoadingRows columns={columns.length} label={t('loadingLabel')} />
            ) : rows.length === 0 && !query.isError ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center">
                  <p className="font-medium">
                    {filtered ? t('noResultsTitle') : (emptyTitle ?? t('emptyTitle'))}
                  </p>
                  <p className="text-sm text-neutral-600">
                    {filtered ? t('noResultsDescription') : emptyDescription}
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={cn(
                    'border-t border-neutral-100',
                    onRowClick && 'cursor-pointer hover:bg-neutral-50',
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((column) => (
                    <td key={column.key} className={cn('px-3 py-2', column.className)}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <nav aria-label={t('pagination')} className="flex items-center justify-between text-sm">
        <span className="text-neutral-600">
          {t('page', { page })}
          {query.data?.total !== undefined ? ` · ${t('total', { total: query.data.total })}` : ''}
        </span>
        <span className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setCursors((c) => c.slice(0, -1))}
          >
            {t('previous')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!query.data?.nextCursor}
            onClick={() =>
              query.data?.nextCursor && setCursors((c) => [...c, query.data?.nextCursor])
            }
          >
            {t('next')}
          </Button>
        </span>
      </nav>
    </div>
  );
}

function LoadingRows({ columns, label }: { columns: number; label: string }) {
  return (
    <>
      {Array.from({ length: 5 }, (_, row) => (
        <tr key={row} className="border-t border-neutral-100" aria-hidden={row > 0}>
          <td colSpan={columns} className="px-3 py-3">
            {row === 0 ? (
              <span className="sr-only" role="status">
                {label}
              </span>
            ) : null}
            <div className="h-4 animate-pulse rounded bg-neutral-200" />
          </td>
        </tr>
      ))}
    </>
  );
}
