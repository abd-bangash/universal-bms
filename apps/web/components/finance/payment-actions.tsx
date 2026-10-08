'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import type { PaymentView } from '@/lib/hooks/use-finance';
import { usePermission } from '@/lib/session';

/** Confirm, reject or void a payment, as the person's permissions allow and the payment's status permits. */
export function PaymentActions({ payment }: { payment: PaymentView }) {
  const t = useTranslations('finance.actions');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const canConfirm = usePermission('payment:confirm');
  const canVoid = usePermission('payment:void');
  const [dialog, setDialog] = useState<'reject' | 'void' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(action: 'confirm' | 'reject' | 'void', body: object = {}) {
    setError(null);
    setPending(true);
    try {
      await api.post(`/payments/${payment.id}/${action}`, body);
      setDialog(null);
      setReason('');
      await Promise.all(
        [['list', 'payments'], ['order'], ['finance'], ['timeline'], ['credit']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  }

  const pendingVerification = payment.status === 'PENDING_VERIFICATION';
  const confirmed = payment.status === 'CONFIRMED';
  if (!(pendingVerification && canConfirm) && !(confirmed && canVoid)) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {error ? (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      ) : null}
      {pendingVerification && canConfirm ? (
        <>
          <Button type="button" size="sm" disabled={pending} onClick={() => void run('confirm')}>
            {t('confirm')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setDialog('reject')}
          >
            {t('reject')}
          </Button>
        </>
      ) : null}
      {confirmed && canVoid ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => setDialog('void')}
        >
          {t('void')}
        </Button>
      ) : null}
      <Modal
        open={dialog !== null}
        title={
          dialog === 'void'
            ? t('voidTitle', { number: payment.paymentNumber })
            : t('rejectTitle', { number: payment.paymentNumber })
        }
        onClose={() => setDialog(null)}
      >
        <div className="flex flex-col gap-3">
          {error ? <Alert>{error}</Alert> : null}
          <Field id={`reason-${payment.id}`} label={t('reason')} required>
            <Textarea
              id={`reason-${payment.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={reason.trim() === '' || pending}
              onClick={() => dialog && void run(dialog, { reason: reason.trim() })}
            >
              {dialog === 'void' ? t('confirmVoid') : t('confirmReject')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
