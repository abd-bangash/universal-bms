'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { DynamicFields } from '@/components/dynamic-fields/dynamic-fields';
import { FormShell } from '@/components/forms/form-shell';
import { MoneyInput } from '@/components/forms/money-input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatMoney } from '@/lib/format';
import {
  ancestorIds,
  useCategoriesQuery,
  useFieldsQuery,
  useUnitsQuery,
  type ProductView,
  type VariantView,
} from '@/lib/hooks/use-catalog';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { useTerminology } from '@/lib/terminology';

interface VariantForm {
  sku: string;
  barcode: string;
  name: string;
  priceOverride: string;
  costOverride: string;
  weight: string;
  minStockLevel: string;
  maxStockLevel: string;
  status: 'ACTIVE' | 'INACTIVE';
  customFields: Record<string, unknown>;
}

const blank: VariantForm = {
  sku: '',
  barcode: '',
  name: '',
  priceOverride: '',
  costOverride: '',
  weight: '',
  minStockLevel: '',
  maxStockLevel: '',
  status: 'ACTIVE',
  customFields: {},
};

const toForm = (v: VariantView): VariantForm => ({
  sku: v.sku,
  barcode: v.barcode ?? '',
  name: v.name ?? '',
  priceOverride: v.priceOverride ?? '',
  costOverride: v.costOverride ?? '',
  weight: v.weight ?? '',
  minStockLevel: v.minStockLevel ?? '',
  maxStockLevel: v.maxStockLevel ?? '',
  status: v.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
  customFields: v.customFields,
});

const STATUS_COLOR = { ACTIVE: '#16a34a', INACTIVE: '#a3a3a3', ARCHIVED: '#78350f' } as const;

/** The variants of a product: price, barcode, stock limits and attributes of each (Requirement 6.2). */
export function VariantsPanel({
  product,
  readOnly,
  onChanged,
}: {
  product: ProductView;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('products.variantsPanel');
  const term = useTerminology();
  const locale = useWorkspaceLocale();
  const [editing, setEditing] = useState<VariantView | 'new' | null>(null);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const variantFields = useFieldsQuery('VARIANT');
  const hasAxes = (variantFields.data ?? []).some((f) => f.active !== false && f.isVariantAxis);
  const variants = product.variants ?? [];

  return (
    <section aria-labelledby="variants-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="variants-heading" className="font-medium">
          {term('variant', 'plural')}
        </h2>
        {readOnly ? null : (
          <div className="flex gap-2">
            {hasAxes ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setGenerating(true)}>
                {t('generate')}
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={() => setEditing('new')}>
              {t('add')}
            </Button>
          </div>
        )}
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <div className="overflow-x-auto rounded-md border border-neutral-200">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t('caption')}</caption>
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-600">
            <tr>
              <th scope="col" className="px-3 py-2">
                {t('sku')}
              </th>
              <th scope="col" className="px-3 py-2">
                {t('barcode')}
              </th>
              <th scope="col" className="px-3 py-2">
                {t('attributes')}
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                {t('price')}
              </th>
              <th scope="col" className="px-3 py-2">
                {t('status')}
              </th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">{t('actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <tr key={v.id} className="border-t border-neutral-200">
                <td className="px-3 py-2 font-medium">
                  {v.sku}
                  {v.isDefault ? (
                    <span className="ml-2 text-xs text-neutral-600">{t('default')}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{v.barcode}</td>
                <td className="px-3 py-2">
                  {Object.entries(v.customFields)
                    .map(
                      ([k, value]) =>
                        `${k}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
                    )
                    .join(', ')}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {v.priceOverride ? formatMoney(v.priceOverride, locale) : t('productPrice')}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge
                    label={t(`statusLabels.${v.status}`)}
                    color={STATUS_COLOR[v.status]}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  {readOnly || v.status === 'ARCHIVED' ? null : (
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditing(v)}>
                      {t('edit')}
                      <span className="sr-only"> {v.sku}</span>
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={editing !== null}
        title={editing === 'new' ? t('addTitle') : t('editTitle', { sku: editing?.sku ?? '' })}
        onClose={() => setEditing(null)}
        wide
      >
        {editing ? (
          <VariantEditor
            key={editing === 'new' ? 'new' : editing.id}
            product={product}
            variant={editing === 'new' ? null : editing}
            onDone={() => {
              setEditing(null);
              setNotice(t('saved'));
              onChanged();
            }}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </Modal>
      <Modal open={generating} title={t('generate')} onClose={() => setGenerating(false)} wide>
        {generating ? (
          <GenerateDialog
            product={product}
            onDone={(message) => {
              setGenerating(false);
              setNotice(message);
              onChanged();
            }}
            onClose={() => setGenerating(false)}
          />
        ) : null}
      </Modal>
    </section>
  );
}

function VariantEditor({
  product,
  variant,
  onDone,
  onClose,
}: {
  product: ProductView;
  variant: VariantView | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('products.variantsPanel');
  const locale = useWorkspaceLocale();
  const canSeeCost = usePermission('product:view_cost');
  const fields = useFieldsQuery('VARIANT');
  const categories = useCategoriesQuery();
  const units = useUnitsQuery();
  const form = useForm<VariantForm>({ defaultValues: variant ? toForm(variant) : blank });
  const { errors } = form.formState;
  const values = form.watch();
  const err = (name: keyof VariantForm) => errors[name]?.message as string | undefined;
  const customErrors = Object.fromEntries(
    Object.entries(errors.customFields ?? {}).map(([k, v]) => [
      k,
      (v as { message?: string } | undefined)?.message,
    ]),
  );

  async function submit(v: VariantForm) {
    const nullable = (s: string) => (s === '' ? null : s);
    const body: Record<string, unknown> = {
      sku: v.sku.trim() || undefined,
      barcode: nullable(v.barcode.trim()),
      name: nullable(v.name.trim()),
      priceOverride: nullable(v.priceOverride),
      weight: nullable(v.weight),
      minStockLevel: nullable(v.minStockLevel),
      maxStockLevel: nullable(v.maxStockLevel),
      status: v.status,
      customFields: v.customFields,
    };
    if (canSeeCost) body.costOverride = nullable(v.costOverride);
    if (variant) await api.patch(`/catalog/variants/${variant.id}`, body);
    else await api.post(`/catalog/products/${product.id}/variants`, body);
    onDone();
  }

  const text = (name: 'sku' | 'barcode' | 'name', label: string, required = false) => (
    <Field id={`variant-${name}`} label={label} error={err(name)} required={required}>
      <Input {...describedBy(`variant-${name}`, { error: err(name) })} {...form.register(name)} />
    </Field>
  );
  const amount = (
    name: 'priceOverride' | 'costOverride' | 'weight' | 'minStockLevel' | 'maxStockLevel',
    label: string,
    decimals: number,
    hint?: string,
  ) => (
    <Field id={`variant-${name}`} label={label} error={err(name)} hint={hint}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <MoneyInput
            {...describedBy(`variant-${name}`, { error: err(name), hint })}
            value={field.value}
            onChange={field.onChange}
            decimals={decimals}
          />
        )}
      />
    </Field>
  );

  return (
    <FormShell
      form={form}
      onSubmit={submit}
      submitLabel={t('save')}
      actions={
        <Button type="button" variant="outline" onClick={onClose}>
          {t('cancel')}
        </Button>
      }
      className="flex flex-col gap-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {text('sku', t('sku'), true)}
        {text('barcode', t('barcode'))}
        {text('name', t('name'))}
        <Field id="variant-status" label={t('status')}>
          <Select id="variant-status" {...form.register('status')}>
            <option value="ACTIVE">{t('statusLabels.ACTIVE')}</option>
            <option value="INACTIVE">{t('statusLabels.INACTIVE')}</option>
          </Select>
        </Field>
        {amount(
          'priceOverride',
          t('priceOverride'),
          locale.currencyDecimals,
          t('priceOverrideHint'),
        )}
        {canSeeCost ? amount('costOverride', t('costOverride'), locale.currencyDecimals) : null}
        {amount('weight', t('weight'), 3)}
        {amount('minStockLevel', t('minStock'), 3)}
        {amount('maxStockLevel', t('maxStock'), 3)}
        <DynamicFields
          definitions={fields.data ?? []}
          values={values.customFields}
          onChange={(next) => form.setValue('customFields', next, { shouldDirty: true })}
          errors={customErrors}
          context={{
            productType: product.type,
            categoryId: product.categoryId,
            categoryPath: ancestorIds(categories.data ?? [], product.categoryId),
            status: values.status,
          }}
          units={units.data}
          currencyDecimals={locale.currencyDecimals}
          idPrefix="variant-cf"
        />
      </div>
    </FormShell>
  );
}

function GenerateDialog({
  product,
  onDone,
  onClose,
}: {
  product: ProductView;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('products.variantsPanel');
  const queryClient = useQueryClient();
  const message = useErrorMessage();
  const fields = useFieldsQuery('VARIANT');
  const axes = (fields.data ?? []).filter(
    (f) => f.active !== false && f.isVariantAxis && (f.options ?? []).length > 0,
  );
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selected = (key: string, all: string[]) => chosen[key] ?? all;
  const toggle = (key: string, option: string, all: string[]) => {
    const current = selected(key, all);
    setChosen({
      ...chosen,
      [key]: current.includes(option) ? current.filter((o) => o !== option) : [...current, option],
    });
  };
  const total = axes.reduce(
    (n, a) =>
      n *
      Math.max(
        selected(
          a.key,
          (a.options ?? []).map((o) => o.key),
        ).length,
        0,
      ),
    axes.length === 0 ? 0 : 1,
  );

  async function run() {
    setError(null);
    setPending(true);
    try {
      const result = await api.post<{ created: unknown[]; skipped: number }>(
        `/catalog/products/${product.id}/generate-variants`,
        {
          axes: axes.map((a) => ({
            key: a.key,
            optionKeys: selected(
              a.key,
              (a.options ?? []).map((o) => o.key),
            ),
          })),
        },
      );
      await queryClient.invalidateQueries({ queryKey: ['catalog', 'product', product.id] });
      onDone(t('generated', { created: result.created.length, skipped: result.skipped }));
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-neutral-600">{t('generateHint')}</p>
      {error ? <Alert>{error}</Alert> : null}
      {axes.map((axis) => {
        const all = (axis.options ?? []).map((o) => o.key);
        return (
          <fieldset key={axis.key} className="flex flex-col gap-1">
            <legend className="font-medium">{axis.label}</legend>
            <div className="flex flex-wrap gap-3">
              {(axis.options ?? []).map((o) => (
                <label key={o.key} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={selected(axis.key, all).includes(o.key)}
                    onChange={() => toggle(axis.key, o.key, all)}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
      <p role="status" className="text-sm">
        {t('willCreate', { count: total })}
      </p>
      <div className="flex gap-2">
        <Button type="button" disabled={pending || total === 0} onClick={() => void run()}>
          {t('generateNow')}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}
