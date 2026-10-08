'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatDate, formatMoney } from '@/lib/format';
import { usePaymentMethods, type PaymentView } from '@/lib/hooks/use-finance';
import type { OrderView } from '@/lib/hooks/use-sales';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { PaymentActions } from './payment-actions';
import { RecordPaymentDialog } from './record-payment-dialog';

export const PAYMENT_STATUS_COLORS = {
  PENDING_VERIFICATION: '#f59e0b',
  CONFIRMED: '#16a34a',
  REJECTED: '#dc2626',
  VOIDED: '#a3a3a3',
} as const;

/** The payments of one order: record, confirm, reject, void, use credit, move an overpayment to credit. */
export function PaymentsPanel({ order }: { order: OrderView }) {
  const t = useTranslations('finance.panel');
  const ts = useTranslations('finance.status');
  const tt = useTranslations('finance.type');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const canView = usePermission('payment:view');
  const canRecord = usePermission('payment:create');
  const canConfirm = usePermission('payment:confirm');
  const methods = usePaymentMethods().data ?? [];
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payments = useQuery({
    queryKey: ['order', order.id, 'payments'],
    enabled: canView,
    queryFn: ({ signal }) =>
      api.getPage<PaymentView>('/payments', { orderId: order.id, limit: 100 }, signal),
    select: (page) => page.items,
  });
  const credit = useQuery({
    queryKey: ['credit', order.customerId],
    enabled: canView && canConfirm,
    queryFn: ({ signal }) =>
      api.get<{ balance: string }>(`/customers/${order.customerId}/credit`, undefined, signal),
  });

  if (!canView) return null;
  const owed = Number(order.balanceDue);
  const available = Number(credit.data?.balance ?? 0);
  const payable = order.status !== 'draft' && order.status !== 'cancelled';
  const methodName = (id: string | null) => methods.find((m) => m.id === id)?.name ?? '';

  async function act(path: string, body: object = {}) {
    setError(null);
    try {
      await api.post(path, body);
      await Promise.all(
        [['order'], ['list', 'payments'], ['credit'], ['timeline']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <section aria-labelledby="payments-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="payments-heading" className="font-medium">
          {t('heading')}
        </h2>
        <div className="flex flex-wrap gap-2">
          {canRecord && payable ? (
            <Button type="button" size="sm" onClick={() => setRecording(true)}>
              {t('record')}
            </Button>
          ) : null}
          {canConfirm && payable && available > 0 && owed > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                void act(`/customers/${order.customerId}/credit/apply`, {
                  orderId: order.id,
                  amount: String(Math.min(available, owed)),
                })
              }
            >
              {t('useCredit', { amount: formatMoney(String(Math.min(available, owed)), locale) })}
            </Button>
          ) : null}
          {canConfirm && owed < 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void act(`/orders/${order.id}/overpayment-to-credit`)}
            >
              {t('overpaymentToCredit', { amount: formatMoney(String(-owed), locale) })}
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {owed < 0 ? (
        <Alert tone="info">{t('overpaid', { amount: formatMoney(String(-owed), locale) })}</Alert>
      ) : null}
      {payments.isSuccess && payments.data.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('none')}</p>
      ) : null}
      <ul className="flex flex-col divide-y rounded border border-neutral-200">
        {(payments.data ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div>
              <p className="font-medium">
                {p.paymentNumber} · {tt(p.type)} ·{' '}
                <span className="tabular-nums">{formatMoney(p.amount, locale)}</span>
              </p>
              <p className="text-neutral-600">
                {formatDate(p.paidAt, locale)}
                {methodName(p.paymentMethodId) ? ` · ${methodName(p.paymentMethodId)}` : ''}
                {p.referenceNumber ? ` · ${p.referenceNumber}` : ''}
                {p.voidReason ? ` · ${p.voidReason}` : ''}
                {p.rejectedReason ? ` · ${p.rejectedReason}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge label={ts(p.status)} color={PAYMENT_STATUS_COLORS[p.status]} />
              <PaymentActions payment={p} />
            </div>
          </li>
        ))}
      </ul>
      {recording ? (
        <RecordPaymentDialog
          open
          onClose={() => setRecording(false)}
          order={{ id: order.id, orderNumber: order.orderNumber, customerId: order.customerId }}
          suggestedAmount={
            Number(order.depositRequired) > Number(order.paidAmount)
              ? String(Number(order.depositRequired) - Number(order.paidAmount))
              : owed > 0
                ? order.balanceDue
                : ''
          }
        />
      ) : null}
    </section>
  );
}
