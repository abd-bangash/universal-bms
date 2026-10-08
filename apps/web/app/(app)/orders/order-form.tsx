'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CustomerPicker } from '@/components/sales/customer-picker';
import { LineEditor, type OrderDiscountDraft } from '@/components/sales/line-editor';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import {
  draftFromLine,
  toLineInput,
  usePricingPreview,
  type LineDraft,
  type OrderView,
} from '@/lib/hooks/use-sales';
import { useTerminology } from '@/lib/terminology';

const newIdempotencyKey = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const SOURCES = ['MESSAGING', 'SOCIAL', 'STORE', 'WEBSITE', 'MANUAL'] as const;

/**
 * Create an order, or edit a draft's lines (order = the draft). A new order gets an Idempotency-Key
 * so a double click or a retry after a dropped connection cannot create two (Requirement 54.1).
 */
export function OrderForm({
  order,
  customer,
  onSaved,
}: {
  order: OrderView | null;
  customer?: { id: string; fullName: string } | null;
  onSaved?: () => void;
}) {
  const t = useTranslations('sales.order.form');
  const term = useTerminology();
  const message = useErrorMessage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [party, setParty] = useState(customer ?? null);
  const [lines, setLines] = useState<LineDraft[]>((order?.items ?? []).map(draftFromLine));
  const [discount, setDiscount] = useState<OrderDiscountDraft>({
    type: order?.discountType ?? '',
    value: order?.discountType ? order.discountValue : '',
  });
  const [source, setSource] = useState(order?.source ?? 'MANUAL');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // one key per form: pressing Create twice sends the same key
  const [idempotencyKey] = useState(newIdempotencyKey);

  const preview = usePricingPreview(
    lines,
    discount.type ? { type: discount.type, value: discount.value } : null,
    party?.id ?? null,
  );

  async function save() {
    setError(null);
    if (!order && !party) {
      setError(t('needCustomer'));
      return;
    }
    setSaving(true);
    try {
      const body = {
        lines: lines.map(toLineInput),
        orderDiscount: discount.type ? { type: discount.type, value: discount.value || '0' } : null,
        source,
        notes: notes.trim() || null,
      };
      if (order) {
        await api.patch(`/orders/${order.id}`, { ...body, version: order.version });
        await queryClient.invalidateQueries({ queryKey: ['order'] });
        onSaved?.();
      } else {
        const created = await api.post<OrderView>(
          '/orders',
          { ...body, customerId: party?.id },
          { headers: { 'Idempotency-Key': idempotencyKey } },
        );
        await queryClient.invalidateQueries({ queryKey: ['orders'] });
        router.push(`/orders/${created.id}`);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {!order ? (
        <div>
          <Link href="/orders" className="text-sm underline">
            {t('back')}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">
            {t('title', { order: term('order').toLowerCase() })}
          </h1>
        </div>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      {order ? null : <CustomerPicker value={party} onChange={setParty} required />}
      <LineEditor
        entity="ORDER_ITEM"
        lines={lines}
        onChange={setLines}
        discount={discount}
        onDiscountChange={setDiscount}
        totals={preview.data}
      />
      <section className="grid gap-3 sm:grid-cols-2" aria-labelledby="order-details">
        <h2 id="order-details" className="font-medium sm:col-span-2">
          {t('details')}
        </h2>
        <Field id="order-source" label={t('source')}>
          <Select id="order-source" value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`sources.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field id="order-notes" label={t('notes')}>
            <Textarea id="order-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </section>
      <div>
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? t('saving') : order ? t('save') : t('create')}
        </Button>
      </div>
    </div>
  );
}
