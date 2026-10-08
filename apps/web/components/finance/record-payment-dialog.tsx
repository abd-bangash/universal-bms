'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { FileUpload } from '@/components/forms/file-upload';
import { MoneyInput } from '@/components/forms/money-input';
import { CustomerPicker } from '@/components/sales/customer-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { newIdempotencyKey, usePaymentMethods, type PaymentView } from '@/lib/hooks/use-finance';
import { usePermission, useWorkspaceLocale } from '@/lib/session';

type Recordable = 'DEPOSIT' | 'ORDER_PAYMENT' | 'ADVANCE';

/**
 * Records a payment against an order (also embedded in the order page) or an advance from a customer.
 * A person who may not confirm records it as waiting for confirmation, and the dialog says so.
 */
export function RecordPaymentDialog({
  open,
  onClose,
  order,
  suggestedAmount,
}: {
  open: boolean;
  onClose: () => void;
  /** Set when opened from an order page; without it the dialog records an advance from a customer. */
  order?: { id: string; orderNumber: string; customerId: string };
  suggestedAmount?: string;
}) {
  const t = useTranslations('finance.record');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const canConfirm = usePermission('payment:confirm');
  const methods = usePaymentMethods();
  const [type, setType] = useState<Recordable>(order ? 'DEPOSIT' : 'ADVANCE');
  const [party, setParty] = useState<{ id: string; fullName: string } | null>(null);
  const [methodId, setMethodId] = useState('');
  const [amount, setAmount] = useState(suggestedAmount ?? '');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [proofId, setProofId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // one key per dialog: pressing Record twice sends the same key
  const [key] = useState(newIdempotencyKey);

  const method = (methods.data ?? []).find((m) => m.id === methodId);

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      await api.post<PaymentView>(
        '/payments',
        {
          type,
          ...(type === 'ADVANCE' ? { customerId: party?.id } : { orderId: order?.id }),
          paymentMethodId: methodId,
          amount,
          ...(reference.trim() ? { referenceNumber: reference.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(proofId ? { proofFileId: proofId } : {}),
        },
        { headers: { 'Idempotency-Key': key } },
      );
      await Promise.all(
        [['list', 'payments'], ['order'], ['finance'], ['timeline'], ['credit']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  const ready =
    methodId !== '' &&
    amount !== '' &&
    Number(amount) > 0 &&
    (type !== 'ADVANCE' || party !== null) &&
    (!method?.requiresReference || reference.trim() !== '');

  return (
    <Modal open={open} title={t('title')} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}
        {!canConfirm ? <Alert tone="info">{t('pendingNotice')}</Alert> : null}
        {order ? (
          <Field id="pay-type" label={t('type')}>
            <Select
              id="pay-type"
              value={type}
              onChange={(e) => setType(e.target.value as Recordable)}
            >
              <option value="DEPOSIT">{t('DEPOSIT')}</option>
              <option value="ORDER_PAYMENT">{t('ORDER_PAYMENT')}</option>
            </Select>
          </Field>
        ) : (
          <CustomerPicker value={party} onChange={setParty} required />
        )}
        {order ? (
          <p className="text-sm text-neutral-600">{t('forOrder', { number: order.orderNumber })}</p>
        ) : (
          <p className="text-sm text-neutral-600">{t('advanceHint')}</p>
        )}
        <Field id="pay-method" label={t('method')} required>
          <Select id="pay-method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
            <option value="" />
            {(methods.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="pay-amount" label={t('amount')} required>
          <MoneyInput
            id="pay-amount"
            value={amount}
            onChange={setAmount}
            decimals={locale.currencyDecimals}
          />
        </Field>
        <Field id="pay-reference" label={t('reference')} required={method?.requiresReference}>
          <Input
            id="pay-reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
        <FileUpload label={t('proof')} onUploaded={(f) => setProofId(f.id)} />
        <Field id="pay-note" label={t('note')}>
          <Textarea id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button type="button" onClick={() => void submit()} disabled={!ready || saving}>
            {saving ? t('saving') : t('submit')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
