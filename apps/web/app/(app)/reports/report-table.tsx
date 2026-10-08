'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import type { ReportColumn, ReportRow } from '@/lib/hooks/use-reports';
import { useWorkspaceLocale } from '@/lib/session';
import { cn } from '@/lib/utils';

const LINKS: Record<string, string> = {
  order: '/orders',
  lead: '/leads',
  purchase: '/purchasing/orders',
};

/** Rows and a totals line for any report or drill-down; money and dates follow the workspace settings. */
export function ReportTable({
  caption,
  columns,
  rows,
  totals,
  onDrill,
}: {
  caption: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: Record<string, string>;
  /** Makes each row open the records behind it. */
  onDrill?: (row: ReportRow) => void;
}) {
  const t = useTranslations('reports.table');
  const locale = useWorkspaceLocale();
  const align = (c: ReportColumn) =>
    c.type === 'money' || c.type === 'number' || c.type === 'percent' ? 'text-right' : 'text-left';

  const show = (c: ReportColumn, row: ReportRow) => {
    const value = row[c.key];
    if (value === null || value === undefined || value === '') return '';
    switch (c.type) {
      case 'money':
        return formatMoney(String(value), locale);
      case 'number':
        return formatNumber(String(value), locale);
      case 'percent':
        return `${value}%`;
      case 'date':
        return /^\d{4}-\d{2}-\d{2}$/.test(String(value))
          ? formatDate(`${value}T12:00:00Z`, locale)
          : String(value);
      default:
        return String(value);
    }
  };
  const cell = (c: ReportColumn, row: ReportRow) => {
    const text = show(c, row);
    if (!c.link) return text;
    const [kind, field] = c.link.split(':') as [string, string];
    const id = row[field];
    return id && LINKS[kind] ? (
      <Link className="underline" href={`${LINKS[kind]}/${id}`}>
        {text}
      </Link>
    ) : (
      text
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-neutral-300">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('px-2 py-2 font-medium', align(c))}>
                {c.label}
              </th>
            ))}
            {onDrill ? (
              <th scope="col" className="px-2 py-2">
                <span className="sr-only">{t('details')}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (onDrill ? 1 : 0)}
                className="px-2 py-6 text-center text-neutral-600"
              >
                {t('empty')}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.key} className="border-b border-neutral-200">
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-2 py-2 tabular-nums', align(c))}>
                    {cell(c, row)}
                  </td>
                ))}
                {onDrill ? (
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      className="underline"
                      aria-label={t('detailsFor', {
                        row: String(row[columns[0]?.key ?? 'key'] ?? row.key),
                      })}
                      onClick={() => onDrill(row)}
                    >
                      {t('details')}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
        {totals && Object.keys(totals).length > 0 && rows.length > 0 ? (
          <tfoot>
            <tr className="font-semibold">
              {columns.map((c, i) => (
                <td key={c.key} className={cn('px-2 py-2 tabular-nums', align(c))}>
                  {i === 0
                    ? t('total')
                    : totals[c.key] === undefined
                      ? ''
                      : show(c, { key: 'total', [c.key]: totals[c.key] })}
                </td>
              ))}
              {onDrill ? <td /> : null}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
