'use client';

import { useState } from 'react';
import Decimal from 'decimal.js';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { MoneyInput } from '@/components/forms/money-input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/errors';
import { useErrorMessage } from '@/lib/error-message';
import { newIdempotencyKey } from '@/lib/hooks/use-finance';
import type { PurchaseView } from '@/lib/hooks/use-purchasing';
import { usePermission, useWorkspaceLocale } from '@/lib/session';

/** Records goods arriving: part or all of what is still to come (Requirement 7.9). */
export function ReceiveDialog({
  purchase,
  onClose,
}: {
  purchase: PurchaseView;
  onClose: () => void;
}) {
  const t = useTranslations('purchasing.receive');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const mayOverReceive = usePermission('purchase:approve');
  const items = purchase.items ?? [];
  const remaining = (i: (typeof items)[number]) =>
    Decimal.max(new Decimal(i.quantity).minus(i.receivedQty), 0);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((i) => [i.id, remaining(i).toFixed()])),
  );
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // one key per dialog: pressing Receive twice sends the same key
  const [key] = useState(newIdempotencyKey);

  const lines = items
    .map((i) => ({ item: i, quantity: quantities[i.id] ?? '' }))
    .filter((l) => l.quantity !== '' && new Decimal(l.quantity).gt(0));
  const tooMany = lines.some(
    (l) => new Decimal(l.quantity).gt(remaining(l.item)) && !mayOverReceive,
  );

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      await api.post(
        `/purchases/${purchase.id}/receive`,
        {
          lines: lines.map((l) => ({
            itemId: l.item.id,
            quantity: l.quantity,
            ...((costs[l.item.id] ?? '') !== '' ? { unitCost: costs[l.item.id] } : {}),
          })),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        { headers: { 'Idempotency-Key': key } },
      );
      await Promise.all(
        [['purchase'], ['list', 'purchases'], ['inventory'], ['supplier']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
      onClose();
    } catch (e) {
      setError(e instanceof ApiError && e.message ? `${message(e)} ${e.message}` : message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={t('title')} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        {error ? <Alert>{error}</Alert> : null}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start text-neutral-600">
              <th className="py-1 text-start">{t('item')}</th>
              <th className="py-1 text-end">{t('toReceive')}</th>
              <th className="py-1 text-start">{t('quantity')}</th>
              <th className="py-1 text-start">{t('unitCost')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t border-neutral-200">
                <td className="py-2 pe-2">
                  {i.name}
                  <span className="ms-2 text-neutral-600">{i.sku}</span>
                </td>
                <td className="py-2 pe-2 text-end tabular-nums">{remaining(i).toFixed()}</td>
                <td className="py-2 pe-2">
                  <Field
                    id={`rc-${i.id}-qty`}
                    label={<span className="sr-only">{t('quantityFor', { sku: i.sku })}</span>}
                  >
                    <MoneyInput
                      id={`rc-${i.id}-qty`}
                      value={quantities[i.id] ?? ''}
                      onChange={(v) => setQuantities((c) => ({ ...c, [i.id]: v }))}
                      decimals={0}
                    />
                  </Field>
                </td>
                <td className="py-2">
                  <Field
                    id={`rc-${i.id}-cost`}
                    label={<span className="sr-only">{t('costFor', { sku: i.sku })}</span>}
                  >
                    <MoneyInput
                      id={`rc-${i.id}-cost`}
                      value={costs[i.id] ?? ''}
                      onChange={(v) => setCosts((c) => ({ ...c, [i.id]: v }))}
                      decimals={locale.currencyDecimals}
                    />
                  </Field>
                  <span className="text-xs text-neutral-600">
                    {t('ordered', { cost: i.unitCost })}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {tooMany ? <Alert tone="info">{t('tooMany')}</Alert> : null}
        <Field id="rc-note" label={t('note')}>
          <Input id="rc-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={saving || lines.length === 0 || tooMany}
            onClick={() => void submit()}
          >
            {t('confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
