'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { PaymentsPanel } from '@/components/finance/payments-panel';
import { NotesPanel } from '@/components/crm/notes-panel';
import { TasksPanel } from '@/components/crm/tasks-panel';
import { TimelinePanel } from '@/components/crm/timeline-panel';
import { LinesTable } from '@/components/sales/lines-table';
import { TotalsPanel } from '@/components/sales/line-editor';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/errors';
import { useErrorMessage } from '@/lib/error-message';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { useWorkflowStates, type InvoiceView, type OrderView } from '@/lib/hooks/use-sales';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { FulfilmentPanel } from './fulfilment-panel';
import { OrderForm } from './order-form';

interface HistoryRow {
  id: string;
  from: string | null;
  to: string;
  note: string | null;
  changedAt: string;
}

/** One order: status control with only the allowed moves, lines, fulfilment, documents, history (Requirements 11, 39). */
export function OrderDetail({ orderId }: { orderId: string }) {
  const t = useTranslations('sales.order.detail');
  const tp = useTranslations('sales.order.payment');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const canEdit = usePermission('order:edit');
  const states = useWorkflowStates('ORDER').data ?? [];
  const stateOf = (key: string) => states.find((s) => s.key === key);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [keepAsCredit, setKeepAsCredit] = useState(false);
  const [pending, setPending] = useState(false);

  const order = useQuery({
    queryKey: ['order', orderId],
    queryFn: ({ signal }) => api.get<OrderView>(`/orders/${orderId}`, undefined, signal),
  });
  const customer = useQuery({
    queryKey: ['customer', order.data?.customerId],
    enabled: !!order.data,
    queryFn: ({ signal }) =>
      api.get<{ id: string; fullName: string }>(
        `/customers/${order.data?.customerId}`,
        undefined,
        signal,
      ),
  });
  const history = useQuery({
    queryKey: ['order', orderId, 'history'],
    queryFn: ({ signal }) =>
      api.get<HistoryRow[]>(`/orders/${orderId}/status-history`, undefined, signal),
  });
  const invoices = useQuery({
    queryKey: ['order', orderId, 'invoices'],
    queryFn: ({ signal }) =>
      api.get<InvoiceView[]>(`/orders/${orderId}/invoices`, undefined, signal),
  });

  if (order.isPending) return <p role="status">…</p>;
  if (order.isError) return <Alert>{message(order.error)}</Alert>;
  const o = order.data;
  const current = stateOf(o.status);
  const draft = current?.systemRole === 'DRAFT';
  const closed = current?.category === 'DONE' || current?.category === 'CANCELLED';
  const isCancel = (key: string) => stateOf(key)?.systemRole === 'CANCELLED';
  const netPaid = Number(o.paidAmount) - Number(o.refundedAmount);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['order'] });
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['timeline'] });
  }

  async function move(to: string, cancelReason?: string, paymentDecision?: 'CREDIT') {
    setError(null);
    setPending(true);
    try {
      const res = await api.post<{ pendingApproval: boolean }>(`/orders/${orderId}/status`, {
        status: to,
        ...(cancelReason ? { reason: cancelReason } : {}),
        ...(paymentDecision ? { paymentDecision } : {}),
      });
      setCancelling(null);
      setReason('');
      setKeepAsCredit(false);
      await refresh();
      if (res.pendingApproval) setError(t('awaitingApproval'));
    } catch (e) {
      // the server's sentence names the amount still to pay or the deposit still missing
      setError(e instanceof ApiError && e.message ? `${message(e)} ${e.message}` : message(e));
    } finally {
      setPending(false);
    }
  }

  async function issueInvoice() {
    setError(null);
    try {
      await api.post(`/orders/${orderId}/invoice`);
      await queryClient.invalidateQueries({ queryKey: ['order', orderId, 'invoices'] });
    } catch (e) {
      setError(message(e));
    }
  }

  const totals = {
    subtotal: o.subtotal,
    discountAmount: o.discountAmount,
    taxAmount: o.taxAmount,
    roundingAmount: '0',
    total: o.totalAmount,
  };

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <Link href="/orders" className="text-sm underline">
          {t('back')}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{o.orderNumber}</h1>
          <StatusBadge label={current?.label ?? o.status} color={current?.color} />
          <span className="text-sm text-neutral-600">{tp(o.paymentStatus)}</span>
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          {customer.data ? (
            <Link href={`/customers/${customer.data.id}`} className="underline">
              {customer.data.fullName}
            </Link>
          ) : null}
          {` · ${formatDate(o.orderDate, locale)}`}
          {o.quotationId ? (
            <>
              {' · '}
              <Link href={`/quotations/${o.quotationId}`} className="underline">
                {t('fromQuotation')}
              </Link>
            </>
          ) : null}
        </p>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {o.cancelReason ? (
        <Alert tone="info">{t('cancelledBecause', { reason: o.cancelReason })}</Alert>
      ) : null}

      {canEdit && !closed ? (
        <section aria-labelledby="status-heading" className="flex flex-col gap-2">
          <h2 id="status-heading" className="font-medium">
            {t('moveTo')}
          </h2>
          <div className="flex flex-wrap gap-2">
            {(o.allowedTransitions ?? []).map((tr) => (
              <Button
                key={tr.to}
                type="button"
                size="sm"
                variant={isCancel(tr.to) ? 'outline' : 'default'}
                disabled={pending}
                onClick={() => (isCancel(tr.to) ? setCancelling(tr.to) : void move(tr.to))}
              >
                {stateOf(tr.to)?.label ?? tr.to}
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-neutral-600">{t('total')}</dt>
          <dd className="tabular-nums">{formatMoney(o.totalAmount, locale)}</dd>
        </div>
        <div>
          <dt className="text-neutral-600">{t('paid')}</dt>
          <dd className="tabular-nums">{formatMoney(o.paidAmount, locale)}</dd>
        </div>
        <div>
          <dt className="text-neutral-600">{t('balance')}</dt>
          <dd className="tabular-nums">{formatMoney(o.balanceDue, locale)}</dd>
        </div>
        {Number(o.depositRequired) > 0 ? (
          <div>
            <dt className="text-neutral-600">{t('depositRequired')}</dt>
            <dd className="tabular-nums">{formatMoney(o.depositRequired, locale)}</dd>
          </div>
        ) : null}
      </dl>

      {draft && canEdit ? (
        <div>
          <Button type="button" variant="outline" onClick={() => setEditing((v) => !v)}>
            {editing ? t('cancelEdit') : t('editLines')}
          </Button>
        </div>
      ) : null}
      {editing ? (
        <OrderForm order={o} customer={customer.data ?? null} onSaved={() => setEditing(false)} />
      ) : (
        <>
          <LinesTable lines={o.items ?? []} />
          <TotalsPanel totals={totals} />
        </>
      )}

      <FulfilmentPanel order={o} canEdit={canEdit && o.status !== 'cancelled'} />

      <section aria-labelledby="documents-heading" className="flex flex-col gap-2">
        <h2 id="documents-heading" className="font-medium">
          {t('documents')}
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            <a
              className="underline"
              href={`/api/bff/orders/${o.id}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              {t('confirmationPdf')}
            </a>
          </li>
          {(invoices.data ?? []).map((inv) => (
            <li key={inv.id}>
              <a
                className="underline"
                href={`/api/bff/invoices/${inv.id}/pdf`}
                target="_blank"
                rel="noreferrer"
              >
                {t('invoicePdf', { number: inv.invoiceNumber })}
              </a>
              <span className="ms-2 text-neutral-600">{formatDate(inv.issuedAt, locale)}</span>
            </li>
          ))}
        </ul>
        {canEdit && !draft && o.status !== 'cancelled' ? (
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => void issueInvoice()}>
              {t('issueInvoice')}
            </Button>
          </div>
        ) : null}
      </section>

      <PaymentsPanel order={o} />

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="font-medium">
          {t('statusHistory')}
        </h2>
        <ol className="mt-2 flex flex-col gap-1 text-sm">
          {(history.data ?? []).map((h) => (
            <li key={h.id}>
              {formatDateTime(h.changedAt, locale)} ·{' '}
              {h.from ? `${stateOf(h.from)?.label ?? h.from} → ` : ''}
              {stateOf(h.to)?.label ?? h.to}
              {h.note ? ` · ${h.note}` : ''}
            </li>
          ))}
        </ol>
      </section>

      <NotesPanel entityType="ORDER" entityId={o.id} canWrite={canEdit} />
      <TasksPanel entityType="ORDER" entityId={o.id} />
      <TimelinePanel path={`/orders/${o.id}/timeline`} queryKey={['order', o.id]} />

      <Modal
        open={cancelling !== null}
        title={t('cancelTitle')}
        onClose={() => setCancelling(null)}
      >
        <div className="flex flex-col gap-3">
          <Field id="cancel-reason" label={t('cancelReason')} required>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {netPaid > 0 ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={keepAsCredit}
                onChange={(e) => setKeepAsCredit(e.target.checked)}
              />
              <span>{t('keepAsCredit', { amount: formatMoney(String(netPaid), locale) })}</span>
            </label>
          ) : null}
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={reason.trim() === '' || pending || (netPaid > 0 && !keepAsCredit)}
              onClick={() =>
                cancelling &&
                void move(cancelling, reason.trim(), netPaid > 0 ? 'CREDIT' : undefined)
              }
            >
              {t('confirmCancel')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
