'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { MoneyInput } from '@/components/forms/money-input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/errors';
import { useErrorMessage } from '@/lib/error-message';
import { formatMoney } from '@/lib/format';
import { newIdempotencyKey } from '@/lib/hooks/use-finance';
import { useLocations } from '@/lib/hooks/use-inventory';
import {
  useActiveSuppliers,
  type PurchaseItemView,
  type PurchaseView,
} from '@/lib/hooks/use-purchasing';
import { newLineKey, useVariantSearch, type VariantPick } from '@/lib/hooks/use-sales';
import { useWorkspaceLocale } from '@/lib/session';
import { useTerminology } from '@/lib/terminology';

interface Row {
  key: string;
  variantId: string;
  label: string;
  quantity: string;
  unitCost: string;
}

const fromItem = (i: PurchaseItemView): Row => ({
  key: newLineKey(),
  variantId: i.variantId,
  label: `${i.name} · ${i.sku}`,
  quantity: i.quantity,
  unitCost: i.unitCost,
});

/**
 * A purchase order: create it, edit a draft, or record a quick purchase that is received in full
 * in the same step (design.md, Purchasing). The server prices and totals; this form shows an estimate.
 */
export function PurchaseForm({
  mode,
  purchase,
  onSaved,
}: {
  mode: 'create' | 'edit' | 'quick';
  purchase?: PurchaseView;
  onSaved?: () => void;
}) {
  const t = useTranslations('purchasing.form');
  const term = useTerminology();
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const suppliers = useActiveSuppliers().data ?? [];
  const locations = (useLocations().data ?? []).filter((l) => l.active);
  const [supplierId, setSupplierId] = useState(purchase?.supplierId ?? '');
  const [locationId, setLocationId] = useState(purchase?.locationId ?? '');
  const [expectedDate, setExpectedDate] = useState(purchase?.expectedDate?.slice(0, 10) ?? '');
  const [taxAmount, setTaxAmount] = useState(purchase?.taxAmount ?? '');
  const [notes, setNotes] = useState(purchase?.notes ?? '');
  const [rows, setRows] = useState<Row[]>((purchase?.items ?? []).map(fromItem));
  const [q, setQ] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // one key per form: pressing Save twice sends the same key
  const [key] = useState(newIdempotencyKey);
  const results = useVariantSearch(q);

  const update = (rowKey: string, patch: Partial<Row>) =>
    setRows((current) => current.map((r) => (r.key === rowKey ? { ...r, ...patch } : r)));
  function add(v: VariantPick) {
    setRows((current) => [
      ...current,
      {
        key: newLineKey(),
        variantId: v.variantId,
        label: `${v.variantName ? `${v.productName} · ${v.variantName}` : v.productName} · ${v.sku}`,
        quantity: '1',
        unitCost: '',
      },
    ]);
    setQ('');
  }

  const subtotal = rows.reduce(
    (sum, r) => sum.plus(new Decimal(r.quantity || '0').mul(r.unitCost || '0')),
    new Decimal(0),
  );
  const total = subtotal.plus(taxAmount || '0');

  async function save() {
    setError(null);
    setErrors({});
    if (!supplierId) {
      setErrors({ supplierId: [t('needSupplier')] });
      return;
    }
    if (rows.length === 0) {
      setError(t('needLines'));
      return;
    }
    setSaving(true);
    try {
      const body = {
        supplierId,
        ...(locationId ? { locationId } : {}),
        expectedDate: expectedDate || null,
        taxAmount: taxAmount || '0',
        notes: notes.trim() || null,
        lines: rows.map((r) => ({
          variantId: r.variantId,
          quantity: r.quantity || '0',
          ...(r.unitCost !== '' ? { unitCost: r.unitCost } : {}),
        })),
      };
      if (mode === 'edit' && purchase) {
        await api.patch(`/purchases/${purchase.id}`, { ...body, version: purchase.version });
        await queryClient.invalidateQueries({ queryKey: ['purchase'] });
        onSaved?.();
      } else if (mode === 'quick') {
        const res = await api.post<{ purchase: PurchaseView }>('/purchases/quick', body, {
          headers: { 'Idempotency-Key': key },
        });
        await queryClient.invalidateQueries({ queryKey: ['inventory'] });
        await queryClient.invalidateQueries({ queryKey: ['list', 'purchases'] });
        router.push(`/purchasing/orders/${res.purchase.id}`);
      } else {
        const created = await api.post<PurchaseView>('/purchases', body);
        await queryClient.invalidateQueries({ queryKey: ['list', 'purchases'] });
        router.push(`/purchasing/orders/${created.id}`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.details) setErrors(e.details);
      setError(e instanceof ApiError && e.message ? `${message(e)} ${e.message}` : message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {mode !== 'edit' ? (
        <div>
          <Link href="/purchasing/orders" className="text-sm underline">
            {t('back')}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">
            {mode === 'quick'
              ? t('quickTitle')
              : t('title', { order: term('purchaseOrder').toLowerCase() })}
          </h1>
          {mode === 'quick' ? <p className="text-sm text-neutral-600">{t('quickHint')}</p> : null}
        </div>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="po-supplier" label={term('supplier')} required error={errors['supplierId']?.[0]}>
          <Select
            id="po-supplier"
            value={supplierId}
            disabled={mode === 'edit' && !!purchase && purchase.status !== 'draft'}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">{t('chooseSupplier')}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="po-location" label={t('location')} hint={t('locationHint')}>
          <Select
            id="po-location"
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
        {mode !== 'quick' ? (
          <Field id="po-expected" label={t('expectedDate')}>
            <Input
              id="po-expected"
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          </Field>
        ) : null}
        <Field id="po-tax" label={t('tax')}>
          <MoneyInput
            id="po-tax"
            value={taxAmount}
            onChange={setTaxAmount}
            decimals={locale.currencyDecimals}
          />
        </Field>
      </div>

      <section aria-labelledby="po-lines-heading" className="flex flex-col gap-3">
        <h2 id="po-lines-heading" className="font-medium">
          {t('lines')}
        </h2>
        <Field id="po-search" label={t('addProduct')}>
          <Input
            id="po-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('searchPlaceholder')}
            autoComplete="off"
          />
        </Field>
        {q.trim().length >= 2 && results.data && results.data.length > 0 ? (
          <ul aria-label={t('results')} className="divide-y rounded border border-neutral-200">
            {results.data.map((v) => (
              <li key={v.variantId}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-neutral-50"
                  onClick={() => add(v)}
                >
                  <span>
                    {v.variantName ? `${v.productName} · ${v.variantName}` : v.productName}
                    <span className="ms-2 text-neutral-600">{v.sku}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {rows.length === 0 ? <p className="text-sm text-neutral-600">{t('noLines')}</p> : null}
        <ol className="flex flex-col gap-2">
          {rows.map((r, index) => (
            <li
              key={r.key}
              className="grid items-end gap-2 rounded border border-neutral-200 p-2 sm:grid-cols-[1fr_6rem_8rem_auto]"
            >
              <p className="font-medium">{r.label}</p>
              <Field
                id={`${r.key}-qty`}
                label={t('quantity')}
                error={errors[`lines[${index}].quantity`]?.[0]}
              >
                <MoneyInput
                  id={`${r.key}-qty`}
                  value={r.quantity}
                  onChange={(quantity) => update(r.key, { quantity })}
                  decimals={0}
                />
              </Field>
              <Field
                id={`${r.key}-cost`}
                label={t('unitCost')}
                error={errors[`lines[${index}].unitCost`]?.[0]}
              >
                <MoneyInput
                  id={`${r.key}-cost`}
                  value={r.unitCost}
                  onChange={(unitCost) => update(r.key, { unitCost })}
                  decimals={locale.currencyDecimals}
                />
              </Field>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t('remove', { n: index + 1 })}
                onClick={() => setRows((c) => c.filter((x) => x.key !== r.key))}
              >
                {t('removeShort')}
              </Button>
            </li>
          ))}
        </ol>
      </section>

      <Field id="po-notes" label={t('notes')}>
        <Textarea id="po-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          {t('estimatedTotal')}:{' '}
          <strong className="tabular-nums">{formatMoney(total.toFixed(), locale)}</strong>
        </p>
        <Button type="button" disabled={saving} onClick={() => void save()}>
          {mode === 'quick' ? t('saveQuick') : t('save')}
        </Button>
      </div>
    </div>
  );
}
