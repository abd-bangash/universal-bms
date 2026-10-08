'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { ApiError } from '@/lib/errors';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { usePurchase } from '@/lib/hooks/use-purchasing';
import { useWorkflowStates } from '@/lib/hooks/use-sales';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { PurchaseForm } from './purchase-form';
import { ReceiveDialog } from './receive-dialog';

/** One purchase order: status moves, lines with what has arrived, receipts, and the PDF (Requirements 7.8, 7.9). */
export function PurchaseDetail({ purchaseId }: { purchaseId: string }) {
  const t = useTranslations('purchasing.detail');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const canEdit = usePermission('purchase:edit');
  const canReceive = usePermission('purchase:receive');
  const states = useWorkflowStates('PURCHASE_ORDER').data ?? [];
  const stateOf = (key: string) => states.find((s) => s.key === key);
  const purchase = usePurchase(purchaseId);
  const [error, setError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);

  if (purchase.isPending) return <p role="status">…</p>;
  if (purchase.isError) return <Alert>{message(purchase.error)}</Alert>;
  const p = purchase.data;
  const current = stateOf(p.status);
  const role = current?.systemRole;
  const draft = role === 'DRAFT';
  const open = role === 'SENT' || role === 'PARTIALLY_RECEIVED';
  const items = p.items ?? [];

  async function move(to: string) {
    setError(null);
    setPending(true);
    try {
      await api.post(`/purchases/${purchaseId}/status`, { status: to });
      await Promise.all(
        [['purchase'], ['list', 'purchases']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    } catch (e) {
      setError(e instanceof ApiError && e.message ? `${message(e)} ${e.message}` : message(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <Link href="/purchasing/orders" className="text-sm underline">
          {t('back')}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{p.orderNumber}</h1>
          <StatusBadge label={current?.label ?? p.status} color={current?.color} />
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          <Link href={`/purchasing/suppliers/${p.supplierId}`} className="underline">
            {p.supplierName}
          </Link>
          {` · ${formatDate(p.orderDate, locale)}`}
          {p.expectedDate
            ? ` · ${t('expected', { date: formatDate(p.expectedDate, locale) })}`
            : ''}
        </p>
      </div>
      {error ? <Alert>{error}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        {canReceive && open ? (
          <Button type="button" onClick={() => setReceiving(true)}>
            {t('receive')}
          </Button>
        ) : null}
        {canEdit
          ? (p.allowedTransitions ?? []).map((tr) => (
              <Button
                key={tr.to}
                type="button"
                size="sm"
                variant={stateOf(tr.to)?.systemRole === 'CANCELLED' ? 'outline' : 'default'}
                disabled={pending}
                onClick={() => void move(tr.to)}
              >
                {stateOf(tr.to)?.label ?? tr.to}
              </Button>
            ))
          : null}
        {canEdit && draft ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? t('cancelEdit') : t('edit')}
          </Button>
        ) : null}
        <Button asChild variant="outline" size="sm">
          <a href={`/api/bff/purchases/${p.id}/pdf`} target="_blank" rel="noreferrer">
            {t('pdf')}
          </a>
        </Button>
      </div>

      {editing ? (
        <PurchaseForm mode="edit" purchase={p} onSaved={() => setEditing(false)} />
      ) : (
        <>
          <table className="w-full text-sm">
            <caption className="sr-only">{t('linesCaption')}</caption>
            <thead>
              <tr className="text-neutral-600">
                <th className="py-1 text-start">{t('item')}</th>
                <th className="py-1 text-end">{t('ordered')}</th>
                <th className="py-1 text-end">{t('received')}</th>
                <th className="py-1 text-end">{t('unitCost')}</th>
                <th className="py-1 text-end">{t('lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t border-neutral-200">
                  <td className="py-2">
                    {i.name}
                    <span className="ms-2 text-neutral-600">{i.sku}</span>
                  </td>
                  <td className="py-2 text-end tabular-nums">{Number(i.quantity)}</td>
                  <td className="py-2 text-end tabular-nums">{Number(i.receivedQty)}</td>
                  <td className="py-2 text-end tabular-nums">{formatMoney(i.unitCost, locale)}</td>
                  <td className="py-2 text-end tabular-nums">{formatMoney(i.lineTotal, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ms-auto flex w-full max-w-xs flex-col gap-1 text-sm">
            <div className="flex justify-between gap-6">
              <dt>{t('subtotal')}</dt>
              <dd className="tabular-nums">{formatMoney(p.subtotal, locale)}</dd>
            </div>
            {Number(p.taxAmount) > 0 ? (
              <div className="flex justify-between gap-6">
                <dt>{t('tax')}</dt>
                <dd className="tabular-nums">{formatMoney(p.taxAmount, locale)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-6 text-base font-semibold">
              <dt>{t('total')}</dt>
              <dd className="tabular-nums">{formatMoney(p.totalAmount, locale)}</dd>
            </div>
          </dl>
        </>
      )}
      {p.notes ? <p className="whitespace-pre-line text-sm">{p.notes}</p> : null}

      <section aria-labelledby="receipts-heading">
        <h2 id="receipts-heading" className="font-medium">
          {t('receipts')}
        </h2>
        {(p.receipts ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">{t('noReceipts')}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {(p.receipts ?? []).map((r) => (
              <li key={r.id}>
                <strong>{r.receiptNumber}</strong> · {formatDateTime(r.receivedAt, locale)} ·{' '}
                {t('receiptLines', { count: r.lines.length })}
                {r.note ? ` · ${r.note}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
      {receiving ? <ReceiveDialog purchase={p} onClose={() => setReceiving(false)} /> : null}
    </div>
  );
}
