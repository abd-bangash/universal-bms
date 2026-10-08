'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { DynamicFields } from '@/components/dynamic-fields/dynamic-fields';
import { FormShell } from '@/components/forms/form-shell';
import { MoneyInput } from '@/components/forms/money-input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import {
  ancestorIds,
  flattenCategories,
  useBrandsQuery,
  useCategoriesQuery,
  useFieldsQuery,
  useTaxClassesQuery,
  useUnitsQuery,
  type ProductView,
} from '@/lib/hooks/use-catalog';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { useTerminology } from '@/lib/terminology';
import { ImagesPanel } from './images-panel';
import { productKey } from './product-editor';
import { VariantsPanel } from './variants-panel';

interface FormValues {
  name: string;
  code: string;
  description: string;
  categoryId: string;
  brandId: string;
  type: 'STOCKABLE' | 'NON_STOCKABLE' | 'SERVICE';
  status: 'ACTIVE' | 'INACTIVE';
  madeToOrder: boolean;
  tracking: 'NONE' | 'BATCH' | 'SERIAL';
  basePrice: string;
  costPrice: string;
  taxClassId: string;
  baseUnitId: string;
  saleUnitId: string;
  aliases: string;
  tags: string;
  visibleInPos: boolean;
  visibleToAi: boolean;
  customFields: Record<string, unknown>;
}

const toList = (text: string): string[] =>
  text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

function defaults(p: ProductView | null): FormValues {
  return {
    name: p?.name ?? '',
    code: p?.code ?? '',
    description: p?.description ?? '',
    categoryId: p?.categoryId ?? '',
    brandId: p?.brandId ?? '',
    type: p && p.type !== 'BUNDLE' ? p.type : 'STOCKABLE',
    status: p?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    madeToOrder: p?.madeToOrder ?? false,
    tracking: p?.tracking ?? 'NONE',
    basePrice: p?.basePrice ?? '',
    costPrice: p?.costPrice ?? '',
    taxClassId: p?.taxClassId ?? '',
    baseUnitId: p?.baseUnitId ?? '',
    saleUnitId: p?.saleUnitId ?? '',
    aliases: (p?.aliases ?? []).join('\n'),
    tags: (p?.tags ?? []).join(', '),
    visibleInPos: p?.visibleInPos ?? true,
    visibleToAi: p?.visibleToAi ?? true,
    customFields: p?.customFields ?? {},
  };
}

/** Create or edit a product (null = create). Variants and images appear once the product exists. */
export function ProductForm({ product }: { product: ProductView | null }) {
  const t = useTranslations('products');
  const term = useTerminology();
  const router = useRouter();
  const queryClient = useQueryClient();
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const canEdit = usePermission(product ? 'product:edit' : 'product:create');
  const canArchive = usePermission('product:archive');
  const canSeeCost = usePermission('product:view_cost');
  const categories = useCategoriesQuery();
  const brands = useBrandsQuery();
  const taxClasses = useTaxClassesQuery();
  const units = useUnitsQuery();
  const productFields = useFieldsQuery('PRODUCT');
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const archived = product?.status === 'ARCHIVED';
  const readOnly = !canEdit || archived;
  const form = useForm<FormValues>({ defaultValues: defaults(product) });
  const { errors } = form.formState;
  const watched = form.watch();

  const flatCategories = useMemo(() => flattenCategories(categories.data ?? []), [categories.data]);
  const customErrors = Object.fromEntries(
    Object.entries(errors.customFields ?? {}).map(([k, v]) => [
      k,
      (v as { message?: string } | undefined)?.message,
    ]),
  );

  function refresh(updated: ProductView) {
    queryClient.setQueryData(productKey(updated.id), updated);
    form.reset(defaults(updated));
    void queryClient.invalidateQueries({ queryKey: ['list', 'products'] });
  }

  async function save(values: FormValues) {
    setNotice(null);
    const body: Record<string, unknown> = {
      name: values.name.trim(),
      description: values.description.trim() || null,
      categoryId: values.categoryId || null,
      brandId: values.brandId || null,
      type: values.type,
      status: values.status,
      madeToOrder: values.madeToOrder,
      tracking: values.type === 'STOCKABLE' ? values.tracking : 'NONE',
      basePrice: values.basePrice,
      taxClassId: values.taxClassId || null,
      baseUnitId: values.baseUnitId || null,
      saleUnitId: values.saleUnitId || null,
      aliases: toList(values.aliases),
      tags: toList(values.tags),
      visibleInPos: values.visibleInPos,
      visibleToAi: values.visibleToAi,
      customFields: values.customFields,
    };
    if (values.code.trim()) body.code = values.code.trim();
    if (canSeeCost) body.costPrice = values.costPrice === '' ? null : values.costPrice;

    if (!product) {
      const created = await api.post<ProductView>('/catalog/products', body);
      await queryClient.invalidateQueries({ queryKey: ['list', 'products'] });
      router.push(`/products/${created.id}`);
      return;
    }
    const updated = await api.patch<ProductView>(`/catalog/products/${product.id}`, {
      ...body,
      version: product.version,
    });
    refresh(updated);
    setNotice(t('saved'));
  }

  async function archive() {
    if (!product) return;
    setActionError(null);
    try {
      refresh(
        await api.post<ProductView>(`/catalog/products/${product.id}/archive`, {
          version: product.version,
        }),
      );
      setConfirmArchive(false);
    } catch (error) {
      setActionError(message(error));
      setConfirmArchive(false);
    }
  }

  async function restore() {
    if (!product) return;
    setActionError(null);
    try {
      refresh(
        await api.patch<ProductView>(`/catalog/products/${product.id}`, {
          version: product.version,
          status: 'ACTIVE',
        }),
      );
    } catch (error) {
      setActionError(message(error));
    }
  }

  const err = (name: keyof FormValues) => errors[name]?.message as string | undefined;
  const text = (
    name: Exclude<
      keyof FormValues,
      'customFields' | 'madeToOrder' | 'visibleInPos' | 'visibleToAi'
    >,
    label: string,
    required = false,
  ) => (
    <Field id={`product-${name}`} label={label} error={err(name)} required={required}>
      <Input
        {...describedBy(`product-${name}`, { error: err(name) })}
        disabled={readOnly}
        {...form.register(name)}
      />
    </Field>
  );
  const select = (
    name: 'categoryId' | 'brandId' | 'taxClassId' | 'baseUnitId' | 'saleUnitId',
    label: string,
    options: Array<{ value: string; label: string }>,
  ) => (
    <Field id={`product-${name}`} label={label} error={err(name)}>
      <Select
        {...describedBy(`product-${name}`, { error: err(name) })}
        disabled={readOnly}
        {...form.register(name)}
      >
        <option value="">{t('none')}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">
          {product ? product.name : t('new', { product: term('product') })}
        </h1>
        {product && !archived && canArchive ? (
          <Button type="button" variant="outline" onClick={() => setConfirmArchive(true)}>
            {t('archive')}
          </Button>
        ) : null}
      </div>

      {archived ? (
        <Alert tone="info" className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('archivedNotice')}</span>
          {canArchive ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void restore()}>
              {t('restore')}
            </Button>
          ) : null}
        </Alert>
      ) : null}
      {actionError ? <Alert>{actionError}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <FormShell
        form={form}
        onSubmit={save}
        submitLabel={product ? t('saveChanges') : t('create')}
        hideSubmit={readOnly}
        className="flex flex-col gap-6"
      >
        <section className="grid gap-3 sm:grid-cols-2" aria-labelledby="product-basics">
          <h2 id="product-basics" className="font-medium sm:col-span-2">
            {t('basics')}
          </h2>
          {text('name', t('name'), true)}
          {text('code', t('code'))}
          <div className="sm:col-span-2">
            <Field id="product-description" label={t('description')} error={err('description')}>
              <Textarea
                {...describedBy('product-description', { error: err('description') })}
                disabled={readOnly}
                {...form.register('description')}
              />
            </Field>
          </div>
          {select(
            'categoryId',
            t('category'),
            flatCategories.map((c) => ({ value: c.id, label: `${'— '.repeat(c.depth)}${c.name}` })),
          )}
          {select(
            'brandId',
            t('brand'),
            (brands.data ?? []).map((b) => ({ value: b.id, label: b.name })),
          )}
          <Field id="product-type" label={t('type')}>
            <Select id="product-type" disabled={readOnly} {...form.register('type')}>
              {(['STOCKABLE', 'NON_STOCKABLE', 'SERVICE'] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`types.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="product-status" label={t('status')}>
            <Select id="product-status" disabled={readOnly} {...form.register('status')}>
              {(['ACTIVE', 'INACTIVE'] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`statusLabels.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          {watched.type === 'STOCKABLE' ? (
            <Field id="product-tracking" label={t('tracking')}>
              <Select id="product-tracking" disabled={readOnly} {...form.register('tracking')}>
                {(['NONE', 'BATCH', 'SERIAL'] as const).map((v) => (
                  <option key={v} value={v}>
                    {t(`trackingLabels.${v}`)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" disabled={readOnly} {...form.register('madeToOrder')} />
            {t('madeToOrder')}
          </label>
        </section>

        <section className="grid gap-3 sm:grid-cols-2" aria-labelledby="product-pricing">
          <h2 id="product-pricing" className="font-medium sm:col-span-2">
            {t('pricing')}
          </h2>
          <Field id="product-basePrice" label={t('price')} error={err('basePrice')} required>
            <Controller
              control={form.control}
              name="basePrice"
              render={({ field }) => (
                <MoneyInput
                  {...describedBy('product-basePrice', { error: err('basePrice') })}
                  value={field.value}
                  onChange={field.onChange}
                  decimals={locale.currencyDecimals}
                  disabled={readOnly}
                />
              )}
            />
          </Field>
          {canSeeCost ? (
            <Field id="product-costPrice" label={t('cost')} error={err('costPrice')}>
              <Controller
                control={form.control}
                name="costPrice"
                render={({ field }) => (
                  <MoneyInput
                    {...describedBy('product-costPrice', { error: err('costPrice') })}
                    value={field.value}
                    onChange={field.onChange}
                    decimals={locale.currencyDecimals}
                    disabled={readOnly}
                  />
                )}
              />
            </Field>
          ) : null}
          {select(
            'taxClassId',
            t('taxClass'),
            (taxClasses.data ?? [])
              .filter((c) => c.active)
              .map((c) => ({ value: c.id, label: c.name })),
          )}
          {select(
            'baseUnitId',
            t('baseUnit'),
            (units.data ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.symbol})` })),
          )}
          {select(
            'saleUnitId',
            t('saleUnit'),
            (units.data ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.symbol})` })),
          )}
        </section>

        {(productFields.data ?? []).length > 0 ? (
          <section className="grid gap-3 sm:grid-cols-2" aria-labelledby="product-attributes">
            <h2 id="product-attributes" className="font-medium sm:col-span-2">
              {t('attributes')}
            </h2>
            <DynamicFields
              definitions={productFields.data ?? []}
              values={watched.customFields}
              onChange={(values) => form.setValue('customFields', values, { shouldDirty: true })}
              errors={customErrors}
              context={{
                productType: watched.type,
                categoryId: watched.categoryId || null,
                categoryPath: ancestorIds(categories.data ?? [], watched.categoryId),
                status: watched.status,
              }}
              currencyDecimals={locale.currencyDecimals}
              units={units.data}
              disabled={readOnly}
              idPrefix="product-cf"
            />
          </section>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2" aria-labelledby="product-search">
          <h2 id="product-search" className="font-medium sm:col-span-2">
            {t('searchAndVisibility')}
          </h2>
          <Field
            id="product-aliases"
            label={t('aliases')}
            hint={t('aliasesHint')}
            error={err('aliases')}
          >
            <Textarea
              {...describedBy('product-aliases', { hint: true, error: err('aliases') })}
              disabled={readOnly}
              {...form.register('aliases')}
            />
          </Field>
          <Field id="product-tags" label={t('tags')} hint={t('tagsHint')} error={err('tags')}>
            <Input
              {...describedBy('product-tags', { hint: true, error: err('tags') })}
              disabled={readOnly}
              {...form.register('tags')}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={readOnly} {...form.register('visibleInPos')} />
            {t('visibleInPos')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={readOnly} {...form.register('visibleToAi')} />
            {t('visibleToAi')}
          </label>
        </section>
      </FormShell>

      {product ? (
        <>
          <VariantsPanel
            product={product}
            readOnly={readOnly}
            onChanged={() =>
              void queryClient.invalidateQueries({ queryKey: productKey(product.id) })
            }
          />
          <ImagesPanel
            product={product}
            readOnly={readOnly}
            onChanged={() =>
              void queryClient.invalidateQueries({ queryKey: productKey(product.id) })
            }
          />
        </>
      ) : null}

      <ConfirmDialog
        open={confirmArchive}
        destructive
        title={t('archiveTitle', { name: product?.name ?? '' })}
        description={t('archiveDescription')}
        confirmLabel={t('archive')}
        onConfirm={() => void archive()}
        onCancel={() => setConfirmArchive(false)}
      />
    </div>
  );
}
