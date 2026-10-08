'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DynamicFields } from '@/components/dynamic-fields/dynamic-fields';
import { MoneyInput } from '@/components/forms/money-input';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { formatMoney } from '@/lib/format';
import { useFieldsQuery, useUnitsQuery } from '@/lib/hooks/use-catalog';
import {
  customDraft,
  draftFromVariant,
  useVariantSearch,
  type LineDraft,
  type PreviewTotals,
} from '@/lib/hooks/use-sales';
import { usePermission, useWorkspaceLocale } from '@/lib/session';

/** Search the catalog by name, code, SKU or barcode and add the chosen variant as a line. */
function VariantPicker({ onPick }: { onPick: (line: LineDraft) => void }) {
  const t = useTranslations('sales.lines');
  const locale = useWorkspaceLocale();
  const [q, setQ] = useState('');
  const results = useVariantSearch(q);
  return (
    <div className="flex flex-col gap-2">
      <Field id="variant-search" label={t('addProduct')}>
        <Input
          id="variant-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchPlaceholder')}
          autoComplete="off"
        />
      </Field>
      {q.trim().length >= 2 && results.data ? (
        results.data.length === 0 ? (
          <p className="text-sm text-neutral-600">{t('noResults')}</p>
        ) : (
          <ul aria-label={t('results')} className="divide-y rounded border border-neutral-200">
            {results.data.map((v) => (
              <li key={v.variantId}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-neutral-50"
                  onClick={() => {
                    onPick(draftFromVariant(v));
                    setQ('');
                  }}
                >
                  <span>
                    {v.variantName ? `${v.productName} · ${v.variantName}` : v.productName}
                    <span className="ms-2 text-neutral-600">{v.sku}</span>
                  </span>
                  <span className="tabular-nums">{formatMoney(v.price, locale)}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

export interface OrderDiscountDraft {
  type: '' | 'AMOUNT' | 'PERCENT';
  value: string;
}

/**
 * The line editor shared by quotations and orders: product picker, custom lines, per-line custom
 * fields, manual price (needs the override permission), discounts and live totals from the server's
 * pricing engine (Requirements 10.1, 35).
 */
export function LineEditor({
  entity,
  lines,
  onChange,
  discount,
  onDiscountChange,
  totals,
  disabled,
}: {
  entity: 'QUOTATION_ITEM' | 'ORDER_ITEM';
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  discount: OrderDiscountDraft;
  onDiscountChange: (discount: OrderDiscountDraft) => void;
  totals: PreviewTotals | undefined;
  disabled?: boolean;
}) {
  const t = useTranslations('sales.lines');
  const locale = useWorkspaceLocale();
  const canOverride = usePermission('order:price_override');
  const fields = useFieldsQuery(entity);
  const units = useUnitsQuery();

  const update = (key: string, patch: Partial<LineDraft>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => onChange(lines.filter((l) => l.key !== key));

  return (
    <section aria-labelledby="lines-heading" className="flex flex-col gap-4">
      <h2 id="lines-heading" className="font-medium">
        {t('heading')}
      </h2>
      {lines.length === 0 ? <p className="text-sm text-neutral-600">{t('empty')}</p> : null}
      <ol className="flex flex-col gap-4">
        {lines.map((line, index) => {
          const id = `${line.key}`;
          return (
            <li key={line.key} className="rounded border border-neutral-200 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-medium">
                  {index + 1}. {line.kind === 'CATALOG' ? line.name : line.name || t('customLine')}
                  {line.sku ? <span className="ms-2 text-neutral-600">{line.sku}</span> : null}
                </p>
                {!disabled ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => remove(line.key)}
                    aria-label={t('remove', { n: index + 1 })}
                  >
                    {t('removeShort')}
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                {line.kind === 'CUSTOM' ? (
                  <div className="sm:col-span-4">
                    <Field id={`${id}-name`} label={t('name')} required>
                      <Input
                        id={`${id}-name`}
                        value={line.name}
                        disabled={disabled}
                        onChange={(e) => update(line.key, { name: e.target.value })}
                      />
                    </Field>
                  </div>
                ) : null}
                <Field id={`${id}-qty`} label={t('quantity')} required>
                  <MoneyInput
                    id={`${id}-qty`}
                    value={line.quantity}
                    onChange={(quantity) => update(line.key, { quantity })}
                    decimals={0}
                    disabled={disabled}
                  />
                </Field>
                <Field
                  id={`${id}-price`}
                  label={t('unitPrice')}
                  required={line.kind === 'CUSTOM'}
                  hint={
                    line.kind === 'CATALOG'
                      ? t('listPrice', { price: formatMoney(line.listPrice, locale) })
                      : undefined
                  }
                >
                  <MoneyInput
                    id={`${id}-price`}
                    value={line.unitPrice}
                    onChange={(unitPrice) => update(line.key, { unitPrice })}
                    decimals={locale.currencyDecimals}
                    disabled={disabled || (line.kind === 'CATALOG' && !canOverride)}
                  />
                </Field>
                <Field id={`${id}-dtype`} label={t('discountType')}>
                  <Select
                    id={`${id}-dtype`}
                    value={line.discountType}
                    disabled={disabled}
                    onChange={(e) =>
                      update(line.key, {
                        discountType: e.target.value as LineDraft['discountType'],
                      })
                    }
                  >
                    <option value="">{t('noDiscount')}</option>
                    <option value="PERCENT">{t('percent')}</option>
                    <option value="AMOUNT">{t('amount')}</option>
                  </Select>
                </Field>
                {line.discountType ? (
                  <Field id={`${id}-dvalue`} label={t('discountValue')}>
                    <MoneyInput
                      id={`${id}-dvalue`}
                      value={line.discountValue}
                      onChange={(discountValue) => update(line.key, { discountValue })}
                      decimals={line.discountType === 'PERCENT' ? 2 : locale.currencyDecimals}
                      disabled={disabled}
                    />
                  </Field>
                ) : null}
                <DynamicFields
                  definitions={fields.data ?? []}
                  values={line.customFields}
                  onChange={(customFields) => update(line.key, { customFields })}
                  units={units.data}
                  currencyDecimals={locale.currencyDecimals}
                  disabled={disabled}
                  idPrefix={`${id}-cf`}
                />
              </div>
            </li>
          );
        })}
      </ol>

      {!disabled ? (
        <div className="flex flex-col gap-3">
          <VariantPicker onPick={(line) => onChange([...lines, line])} />
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange([...lines, customDraft()])}
            >
              {t('addCustom')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="order-discount-type" label={t('orderDiscount')}>
          <Select
            id="order-discount-type"
            value={discount.type}
            disabled={disabled}
            onChange={(e) =>
              onDiscountChange({ ...discount, type: e.target.value as OrderDiscountDraft['type'] })
            }
          >
            <option value="">{t('noDiscount')}</option>
            <option value="PERCENT">{t('percent')}</option>
            <option value="AMOUNT">{t('amount')}</option>
          </Select>
        </Field>
        {discount.type ? (
          <Field id="order-discount-value" label={t('discountValue')}>
            <MoneyInput
              id="order-discount-value"
              value={discount.value}
              onChange={(value) => onDiscountChange({ ...discount, value })}
              decimals={discount.type === 'PERCENT' ? 2 : locale.currencyDecimals}
              disabled={disabled}
            />
          </Field>
        ) : null}
      </div>

      <TotalsPanel totals={totals} />
    </section>
  );
}

/** Subtotal, discount, tax and total as the server's pricing engine calculates them. */
export function TotalsPanel({ totals }: { totals: PreviewTotals | undefined }) {
  const t = useTranslations('sales.totals');
  const locale = useWorkspaceLocale();
  if (!totals) return null;
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between gap-6 ${strong ? 'text-base font-semibold' : ''}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatMoney(value, locale)}</dd>
    </div>
  );
  return (
    <dl aria-label={t('heading')} className="ms-auto flex w-full max-w-xs flex-col gap-1 text-sm">
      {row(t('subtotal'), totals.subtotal)}
      {Number(totals.discountAmount) > 0 ? row(t('discount'), `-${totals.discountAmount}`) : null}
      {Number(totals.taxAmount) > 0 ? row(t('tax'), totals.taxAmount) : null}
      {Number(totals.roundingAmount) !== 0 ? row(t('rounding'), totals.roundingAmount) : null}
      {row(t('total'), totals.total, true)}
    </dl>
  );
}
