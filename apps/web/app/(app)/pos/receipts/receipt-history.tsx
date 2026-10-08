'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatDateTime, formatMoney } from '@/lib/format';
import { openReceiptPdf, type ReceiptRow } from '@/lib/hooks/use-pos';
import { usePermission, useWorkspaceLocale } from '@/lib/session';

/** Past sale receipts, searchable, with reprint (Requirements 12.14, 29.8). */
export function ReceiptHistory() {
  const t = useTranslations('pos.history');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const canReprint = usePermission('pos:reprint');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reprint(row: ReceiptRow) {
    setError(null);
    setBusy(row.id);
    try {
      await api.post(`/pos/receipts/${row.id}/reprint`);
      await openReceiptPdf(row.id);
      await queryClient.invalidateQueries({ queryKey: ['list', 'pos-receipts'] });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  const columns: Array<Column<ReceiptRow>> = [
    { key: 'number', header: t('number'), cell: (r) => r.receiptNumber },
    { key: 'order', header: t('order'), cell: (r) => r.orderNumber ?? '' },
    { key: 'customer', header: t('customer'), cell: (r) => r.customerName ?? t('walkIn') },
    {
      key: 'total',
      header: t('total'),
      className: 'text-right',
      cell: (r) => <span className="tabular-nums">{formatMoney(r.totalAmount, locale)}</span>,
    },
    { key: 'when', header: t('when'), cell: (r) => formatDateTime(r.issuedAt, locale) },
    {
      key: 'reprints',
      header: t('reprints'),
      className: 'text-right',
      cell: (r) => (r.reprintCount > 0 ? r.reprintCount : ''),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('actions')}</span>,
      cell: (r) =>
        canReprint ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy === r.id}
            aria-label={t('reprintLabel', { number: r.receiptNumber })}
            onClick={() => void reprint(r)}
          >
            {t('reprint')}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {error ? <Alert>{error}</Alert> : null}
      <DataTable<ReceiptRow>
        queryKey="pos-receipts"
        endpoint="/pos/receipts"
        caption={t('caption')}
        columns={columns}
        rowKey={(r) => r.id}
        emptyTitle={t('empty')}
        emptyDescription={t('emptyDescription')}
      />
    </div>
  );
}
