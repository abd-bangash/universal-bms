'use client';

import { useState } from 'react';
import Decimal from 'decimal.js';
import { useTranslations } from 'next-intl';
import { MoneyInput } from '@/components/forms/money-input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { formatMoney } from '@/lib/format';
import type { MethodView } from '@/lib/hooks/use-finance';
import { useWorkspaceLocale } from '@/lib/session';

export interface PaymentChoice {
  paymentMethodId: string;
  tendered?: string;
  referenceNumber?: string;
}

/**
 * Takes the payment: one method, the amount handed over, the change to give back. The sale is not
 * recorded until Complete is pressed; while it is being sent the button is locked (Requirement 54.1).
 */
export function PayDialog({
  open,
  onClose,
  methods,
  total,
  cashTotal,
  pending,
  error,
  unreachable,
  onConfirm,
  onRetry,
}: {
  open: boolean;
  onClose: () => void;
  methods: MethodView[];
  /** The total for non-cash methods. */
  total: string;
  /** The total after cash rounding, when it differs. */
  cashTotal: string;
  pending: boolean;
  error: string | null;
  /** The API could not be reached: the sale may or may not have been recorded. */
  unreachable: boolean;
  onConfirm: (payment: PaymentChoice) => void;
  onRetry: () => void;
}) {
  const t = useTranslations('pos.pay');
  const locale = useWorkspaceLocale();
  const [methodId, setMethodId] = useState(() => methods.find((m) => m.type === 'CASH')?.id ?? '');
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');

  const method = methods.find((m) => m.id === methodId);
  const isCash = method?.type === 'CASH';
  const due = isCash ? cashTotal : total;
  const handed = isCash ? (tendered === '' ? due : tendered) : due;
  const change = Decimal.max(new Decimal(handed || '0').minus(due), 0);
  const short = new Decimal(handed || '0').lt(due);
  const needsReference = !!method?.requiresReference && reference.trim() === '';
  const canComplete = !!method && !short && !needsReference && !pending;

  return (
    <Modal open={open} title={t('title')} onClose={pending ? () => undefined : onClose}>
      <div className="flex flex-col gap-4">
        {unreachable ? (
          <Alert>
            <p className="font-medium">{t('unreachableTitle')}</p>
            <p>{t('unreachable')}</p>
            <Button type="button" className="mt-2" onClick={onRetry} disabled={pending}>
              {t('retry')}
            </Button>
          </Alert>
        ) : error ? (
          <Alert>{error}</Alert>
        ) : null}
        <p className="text-2xl font-semibold tabular-nums" aria-label={t('amountDue')}>
          {formatMoney(due, locale)}
        </p>
        <Field id="pay-method" label={t('method')} required>
          <Select
            id="pay-method"
            value={methodId}
            onChange={(e) => {
              setMethodId(e.target.value);
              setTendered('');
            }}
          >
            <option value="">{t('chooseMethod')}</option>
            {methods
              .filter((m) => m.active)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </Select>
        </Field>
        {isCash ? (
          <Field id="pay-tendered" label={t('tendered')}>
            <MoneyInput
              id="pay-tendered"
              value={tendered}
              onChange={setTendered}
              decimals={locale.currencyDecimals}
            />
          </Field>
        ) : null}
        {method?.requiresReference ? (
          <Field id="pay-reference" label={t('reference')} required>
            <Input
              id="pay-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
        ) : null}
        {isCash ? (
          <p aria-live="polite">
            {short ? (
              <span className="text-red-700">{t('short')}</span>
            ) : (
              <>
                {t('change')}:{' '}
                <strong className="tabular-nums">{formatMoney(change.toFixed(), locale)}</strong>
              </>
            )}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={!canComplete}
            onClick={() =>
              onConfirm({
                paymentMethodId: methodId,
                ...(isCash && tendered !== '' ? { tendered } : {}),
                ...(reference.trim() ? { referenceNumber: reference.trim() } : {}),
              })
            }
          >
            {pending ? t('completing') : t('complete')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
