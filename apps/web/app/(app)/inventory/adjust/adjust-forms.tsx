'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { MoneyInput } from '@/components/forms/money-input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { newIdempotencyKey } from '@/lib/hooks/use-finance';
import { useAdjustmentReasons, useLocations } from '@/lib/hooks/use-inventory';
import { useVariantSearch, type VariantPick } from '@/lib/hooks/use-sales';
import { useWorkspaceLocale } from '@/lib/session';

function VariantChooser({
  value,
  onChange,
  idPrefix,
}: {
  value: VariantPick | null;
  onChange: (v: VariantPick | null) => void;
  idPrefix: string;
}) {
  const t = useTranslations('inventory.adjust');
  const [q, setQ] = useState('');
  const results = useVariantSearch(q);
  if (value) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span>
          {value.variantName ? `${value.productName} · ${value.variantName}` : value.productName}{' '}
          <span className="text-neutral-600">{value.sku}</span>
        </span>
        <button type="button" className="underline" onClick={() => onChange(null)}>
          {t('change')}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Field id={`${idPrefix}-search`} label={t('item')} required>
        <Input
          id={`${idPrefix}-search`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchPlaceholder')}
          autoComplete="off"
        />
      </Field>
      {results.data && results.data.length > 0 ? (
        <ul aria-label={t('results')} className="divide-y rounded border border-neutral-200">
          {results.data.map((v) => (
            <li key={v.variantId}>
              <button
                type="button"
                className="w-full px-3 py-2 text-start text-sm hover:bg-neutral-50"
                onClick={() => {
                  onChange(v);
                  setQ('');
                }}
              >
                {v.variantName ? `${v.productName} · ${v.variantName}` : v.productName}
                <span className="ms-2 text-neutral-600">{v.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

async function refresh(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all(
    [['list', 'stock'], ['list', 'movements'], ['inventory']].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}

/** A manual adjustment in or out; every one says why (Requirement 37.2). */
export function AdjustForm() {
  const t = useTranslations('inventory.adjust');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const locations = useLocations().data ?? [];
  const reasons = useAdjustmentReasons().data ?? [];
  const [variant, setVariant] = useState<VariantPick | null>(null);
  const [locationId, setLocationId] = useState('');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [quantity, setQuantity] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await api.post(
        '/inventory/movements',
        {
          variantId: variant?.variantId,
          direction,
          quantity,
          reasonId,
          ...(locationId ? { locationId } : {}),
          ...(direction === 'IN' && unitCost ? { unitCost } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        { headers: { 'Idempotency-Key': key } },
      );
      await refresh(queryClient);
      setNotice(t('saved'));
      setKey(newIdempotencyKey()); // the next adjustment is a new one
      setQuantity('');
      setNote('');
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="adjust-heading" className="flex max-w-xl flex-col gap-3">
      <h2 id="adjust-heading" className="text-xl font-semibold">
        {t('adjustTitle')}
      </h2>
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <VariantChooser value={variant} onChange={setVariant} idPrefix="adj" />
      <Field id="adj-direction" label={t('direction')}>
        <Select
          id="adj-direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value as 'IN' | 'OUT')}
        >
          <option value="OUT">{t('out')}</option>
          <option value="IN">{t('in')}</option>
        </Select>
      </Field>
      <Field id="adj-quantity" label={t('quantity')} required>
        <MoneyInput id="adj-quantity" value={quantity} onChange={setQuantity} decimals={0} />
      </Field>
      <Field id="adj-reason" label={t('reason')} required>
        <Select id="adj-reason" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
          <option value="" />
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      {direction === 'IN' ? (
        <Field id="adj-cost" label={t('unitCost')} hint={t('unitCostHint')}>
          <MoneyInput
            id="adj-cost"
            value={unitCost}
            onChange={setUnitCost}
            decimals={locale.currencyDecimals}
          />
        </Field>
      ) : null}
      {locations.length > 1 ? (
        <Field id="adj-location" label={t('location')}>
          <Select
            id="adj-location"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">{t('defaultLocation')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field id="adj-note" label={t('note')}>
        <Textarea id="adj-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div>
        <Button
          type="button"
          disabled={saving || !variant || !(Number(quantity) > 0) || !reasonId}
          onClick={() => void save()}
        >
          {saving ? t('saving') : t('post')}
        </Button>
      </div>
    </section>
  );
}

interface OpeningLine {
  variant: VariantPick;
  quantity: string;
  unitCost: string;
}

/** Opening stock per item, entered once, with a unit cost (Requirement 37.1). */
export function OpeningStockForm() {
  const t = useTranslations('inventory.adjust');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<OpeningLine[]>([]);
  const [picked, setPicked] = useState<VariantPick | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const [saving, setSaving] = useState(false);

  function add(v: VariantPick | null) {
    setPicked(null);
    if (!v || lines.some((l) => l.variant.variantId === v.variantId)) return;
    setLines([...lines, { variant: v, quantity: '', unitCost: '' }]);
  }
  const patch = (id: string, p: Partial<OpeningLine>) =>
    setLines(lines.map((l) => (l.variant.variantId === id ? { ...l, ...p } : l)));

  async function save() {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await api.post(
        '/inventory/opening-stock',
        {
          lines: lines.map((l) => ({
            variantId: l.variant.variantId,
            quantity: l.quantity,
            unitCost: l.unitCost,
          })),
        },
        { headers: { 'Idempotency-Key': key } },
      );
      await refresh(queryClient);
      setNotice(t('openingSaved'));
      setLines([]);
      setKey(newIdempotencyKey());
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  const ready = lines.length > 0 && lines.every((l) => Number(l.quantity) > 0 && l.unitCost !== '');
  return (
    <section aria-labelledby="opening-heading" className="flex max-w-xl flex-col gap-3">
      <h2 id="opening-heading" className="text-xl font-semibold">
        {t('openingTitle')}
      </h2>
      <p className="text-sm text-neutral-600">{t('openingHint')}</p>
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <VariantChooser value={picked} onChange={add} idPrefix="open" />
      <ul className="flex flex-col gap-3">
        {lines.map((l) => (
          <li key={l.variant.variantId} className="rounded border border-neutral-200 p-3">
            <p className="mb-2 text-sm font-medium">
              {l.variant.productName} <span className="text-neutral-600">{l.variant.sku}</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field id={`open-qty-${l.variant.variantId}`} label={t('quantity')} required>
                <MoneyInput
                  id={`open-qty-${l.variant.variantId}`}
                  value={l.quantity}
                  onChange={(quantity) => patch(l.variant.variantId, { quantity })}
                  decimals={0}
                />
              </Field>
              <Field id={`open-cost-${l.variant.variantId}`} label={t('unitCost')} required>
                <MoneyInput
                  id={`open-cost-${l.variant.variantId}`}
                  value={l.unitCost}
                  onChange={(unitCost) => patch(l.variant.variantId, { unitCost })}
                  decimals={locale.currencyDecimals}
                />
              </Field>
            </div>
            <button
              type="button"
              className="mt-2 text-sm underline"
              onClick={() => setLines(lines.filter((x) => x !== l))}
            >
              {t('removeLine')}
            </button>
          </li>
        ))}
      </ul>
      <div>
        <Button type="button" disabled={saving || !ready} onClick={() => void save()}>
          {saving ? t('saving') : t('postOpening')}
        </Button>
      </div>
    </section>
  );
}
