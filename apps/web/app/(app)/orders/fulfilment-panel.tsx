'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import type { OrderView } from '@/lib/hooks/use-sales';

const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Pickup or delivery, address, schedule, and who received it (Requirement 39.9). */
export function FulfilmentPanel({ order, canEdit }: { order: OrderView; canEdit: boolean }) {
  const t = useTranslations('sales.order.fulfilment');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const [method, setMethod] = useState(order.fulfilmentMethod ?? '');
  const [line1, setLine1] = useState(order.deliveryAddress?.line1 ?? '');
  const [city, setCity] = useState(order.deliveryAddress?.city ?? '');
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(order.scheduledAt));
  const [receiver, setReceiver] = useState(order.receiverName ?? '');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setNotice(null);
    setError(null);
    try {
      await api.patch(`/orders/${order.id}/fulfilment`, {
        method: method || null,
        deliveryAddress: line1 || city ? { line1, city } : null,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        receiverName: receiver.trim() || null,
      });
      await queryClient.invalidateQueries({ queryKey: ['order'] });
      setNotice(t('saved'));
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <section aria-labelledby="fulfilment-heading" className="flex flex-col gap-3">
      <h2 id="fulfilment-heading" className="font-medium">
        {t('heading')}
      </h2>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="ful-method" label={t('method')}>
          <Select
            id="ful-method"
            value={method}
            disabled={!canEdit}
            onChange={(e) => setMethod(e.target.value as typeof method)}
          >
            <option value="" />
            <option value="PICKUP">{t('PICKUP')}</option>
            <option value="DELIVERY">{t('DELIVERY')}</option>
          </Select>
        </Field>
        <Field id="ful-when" label={t('scheduledAt')}>
          <Input
            id="ful-when"
            type="datetime-local"
            value={scheduledAt}
            disabled={!canEdit}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </Field>
        {method === 'DELIVERY' ? (
          <>
            <Field id="ful-line1" label={t('address')}>
              <Input
                id="ful-line1"
                value={line1}
                disabled={!canEdit}
                onChange={(e) => setLine1(e.target.value)}
              />
            </Field>
            <Field id="ful-city" label={t('city')}>
              <Input
                id="ful-city"
                value={city}
                disabled={!canEdit}
                onChange={(e) => setCity(e.target.value)}
              />
            </Field>
          </>
        ) : null}
        <Field id="ful-receiver" label={t('receiver')}>
          <Input
            id="ful-receiver"
            value={receiver}
            disabled={!canEdit}
            onChange={(e) => setReceiver(e.target.value)}
          />
        </Field>
      </div>
      {canEdit ? (
        <div>
          <Button type="button" onClick={() => void save()}>
            {t('save')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
