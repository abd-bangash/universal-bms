'use client';

import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/format';
import type { LineView } from '@/lib/hooks/use-sales';
import { useWorkspaceLocale } from '@/lib/session';

/** The lines of a saved quotation or order, with each line's custom field snapshot. */
export function LinesTable({ lines }: { lines: LineView[] }) {
  const t = useTranslations('sales.lines');
  const locale = useWorkspaceLocale();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{t('heading')}</caption>
        <thead>
          <tr className="border-b text-start">
            <th scope="col" className="py-2 pe-3 text-start">
              {t('item')}
            </th>
            <th scope="col" className="px-3 text-right">
              {t('quantity')}
            </th>
            <th scope="col" className="px-3 text-right">
              {t('unitPrice')}
            </th>
            <th scope="col" className="px-3 text-right">
              {t('discount')}
            </th>
            <th scope="col" className="ps-3 text-right">
              {t('lineTotal')}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b align-top">
              <td className="py-2 pe-3">
                <p className="font-medium">{l.name}</p>
                {l.sku ? <p className="text-xs text-neutral-600">{l.sku}</p> : null}
                {(l.fieldSnapshot ?? []).map((f) => (
                  <p key={f.key} className="text-xs text-neutral-600">
                    {f.label}: {f.value}
                    {f.unit ? ` ${f.unit}` : ''}
                  </p>
                ))}
              </td>
              <td className="px-3 text-right tabular-nums">{Number(l.quantity)}</td>
              <td className="px-3 text-right tabular-nums">{formatMoney(l.unitPrice, locale)}</td>
              <td className="px-3 text-right tabular-nums">
                {Number(l.discountAmount) > 0 ? formatMoney(l.discountAmount, locale) : '—'}
              </td>
              <td className="ps-3 text-right tabular-nums">{formatMoney(l.lineTotal, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
