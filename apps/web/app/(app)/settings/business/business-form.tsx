'use client';

import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { FormShell } from '@/components/forms/form-shell';
import { FileUpload } from '@/components/forms/file-upload';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import {
  SETTINGS_QUERY_KEY,
  type SettingsSnapshot,
  type WorkspaceSettings,
} from '@/lib/hooks/use-settings';
import { numberExample } from '@/lib/numbering';
import { usePermission } from '@/lib/session';

const DOC_TYPES = [
  'QUOTATION',
  'ORDER',
  'INVOICE',
  'RECEIPT',
  'REFUND_RECEIPT',
  'PURCHASE_ORDER',
  'GOODS_RECEIPT',
  'RETURN',
  'PAYMENT',
] as const;
const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'D MMM YYYY'] as const;

function timezones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;
  return supported ? supported('timeZone') : ['UTC'];
}

type FormValues = Pick<
  WorkspaceSettings,
  'business' | 'branding' | 'locale' | 'tax' | 'numbering' | 'documents' | 'sales'
>;

function toFormValues(config: WorkspaceSettings): FormValues {
  const blank = (v: string | undefined) => v ?? '';
  return {
    business: {
      legalName: config.business.legalName,
      phone: blank(config.business.phone),
      email: blank(config.business.email),
      address: blank(config.business.address),
      taxNumber: blank(config.business.taxNumber),
    },
    branding: {
      logoFileId: blank(config.branding.logoFileId),
      primaryColor: blank(config.branding.primaryColor),
    },
    locale: { ...config.locale },
    tax: { enabled: config.tax.enabled, pricesIncludeTax: config.tax.pricesIncludeTax },
    numbering: Object.fromEntries(DOC_TYPES.map((type) => [type, { ...config.numbering[type]! }])),
    documents: {
      receiptPaper: config.documents.receiptPaper,
      receiptFooter: blank(config.documents.receiptFooter),
      quotationTerms: blank(config.documents.quotationTerms),
      invoiceTerms: blank(config.documents.invoiceTerms),
      showBankDetails: config.documents.showBankDetails,
      quotationValidityDays: config.documents.quotationValidityDays,
    },
    sales: {
      requiredDepositPercent: config.sales.requiredDepositPercent,
      discountOverLimit: config.sales.discountOverLimit,
    },
  };
}

export function BusinessForm({ snapshot }: { snapshot: SettingsSnapshot }) {
  const t = useTranslations('settings.business');
  const tSettings = useTranslations('settings');
  const canEdit = usePermission('workspace:configure');
  const queryClient = useQueryClient();
  const zones = useMemo(timezones, []);
  const form = useForm<FormValues>({ defaultValues: toFormValues(snapshot.config) });
  const { register, control } = form;
  const errors = form.formState.errors;
  const numbering = useWatch({ control, name: 'numbering' });
  const logoId = useWatch({ control, name: 'branding.logoFileId' });
  const year = new Date().getFullYear();

  async function save(values: FormValues) {
    const updated = await api.patch<SettingsSnapshot>('/settings', values);
    queryClient.setQueryData(SETTINGS_QUERY_KEY, updated);
    form.reset(toFormValues(updated.config));
  }

  const field = (
    name: string,
    label: string,
    input: (id: string, aria: ReturnType<typeof describedBy>) => React.ReactNode,
    hint?: string,
  ) => {
    const id = name.replace(/\./g, '-');
    const error = name
      .split('.')
      .reduce<unknown>(
        (node, key) => (node as Record<string, unknown> | undefined)?.[key],
        errors,
      ) as { message?: string } | undefined;
    return (
      <Field id={id} label={label} error={error?.message} hint={hint}>
        {input(id, describedBy(id, { error: error?.message, hint }))}
      </Field>
    );
  };

  return (
    <FormShell
      form={form}
      onSubmit={save}
      successMessage={tSettings('saved')}
      className="flex flex-col gap-6"
      hideSubmit={!canEdit}
    >
      {!canEdit ? <Alert tone="info">{tSettings('readOnly')}</Alert> : null}
      <fieldset disabled={!canEdit} className="flex flex-col gap-6">
        <Card className="grid gap-4 sm:grid-cols-2">
          <h2 className="text-lg font-semibold sm:col-span-2">{t('profile')}</h2>
          {field('business.legalName', t('legalName'), (id, aria) => (
            <Input {...aria} {...register('business.legalName')} />
          ))}
          {field('business.phone', t('phone'), (id, aria) => (
            <Input {...aria} type="tel" autoComplete="tel" {...register('business.phone')} />
          ))}
          {field('business.email', t('email'), (id, aria) => (
            <Input {...aria} type="email" autoComplete="email" {...register('business.email')} />
          ))}
          {field('business.taxNumber', t('taxNumber'), (id, aria) => (
            <Input {...aria} {...register('business.taxNumber')} />
          ))}
          <div className="sm:col-span-2">
            {field('business.address', t('address'), (id, aria) => (
              <Textarea {...aria} {...register('business.address')} />
            ))}
          </div>
        </Card>

        <Card className="grid gap-4 sm:grid-cols-2">
          <h2 className="text-lg font-semibold sm:col-span-2">{t('branding')}</h2>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{t('logo')}</p>
            <p className="text-sm text-neutral-600">{logoId ? t('logoUploaded') : t('logoNone')}</p>
            {canEdit ? (
              <div className="flex flex-wrap items-center gap-2">
                <Controller
                  control={control}
                  name="branding.logoFileId"
                  render={({ field: f }) => (
                    <FileUpload
                      accept="image/jpeg,image/png,image/webp"
                      purpose="image"
                      onUploaded={(file) => f.onChange(file.id)}
                    />
                  )}
                />
                {logoId ? (
                  <button
                    type="button"
                    className="text-sm underline"
                    onClick={() => form.setValue('branding.logoFileId', '', { shouldDirty: true })}
                  >
                    {t('removeLogo')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {field('branding.primaryColor', t('primaryColor'), (id, aria) => (
            <Input
              {...aria}
              placeholder="#1e3a8a"
              maxLength={7}
              {...register('branding.primaryColor')}
            />
          ))}
        </Card>

        <Card className="grid gap-4 sm:grid-cols-2">
          <h2 className="text-lg font-semibold sm:col-span-2">{t('regional')}</h2>
          {field('locale.currency', t('currency'), (id, aria) => (
            <Input
              {...aria}
              maxLength={3}
              className="uppercase"
              {...register('locale.currency', { setValueAs: (v: string) => v.toUpperCase() })}
            />
          ))}
          {field('locale.currencyDecimals', t('currencyDecimals'), (id, aria) => (
            <Select {...aria} {...register('locale.currencyDecimals', { valueAsNumber: true })}>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          ))}
          {field('locale.timezone', t('timezone'), (id, aria) => (
            <>
              <Input
                {...aria}
                list="timezone-options"
                autoComplete="off"
                {...register('locale.timezone')}
              />
              <datalist id="timezone-options">
                {zones.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </>
          ))}
          {field(
            'locale.defaultCountry',
            t('defaultCountry'),
            (id, aria) => (
              <Input
                {...aria}
                maxLength={2}
                autoComplete="off"
                {...register('locale.defaultCountry', {
                  setValueAs: (v: string) => v.toUpperCase(),
                })}
              />
            ),
            t('defaultCountryHint'),
          )}
          {field('locale.dateFormat', t('dateFormat'), (id, aria) => (
            <Select {...aria} {...register('locale.dateFormat')}>
              {DATE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          ))}
          {field('locale.language', t('language'), (id, aria) => (
            <Select {...aria} {...register('locale.language')}>
              <option value="en">English</option>
            </Select>
          ))}
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t('tax')}</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register('tax.enabled')} /> {t('taxEnabled')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register('tax.pricesIncludeTax')} /> {t('pricesIncludeTax')}
          </label>
        </Card>

        <Card className="grid gap-4 sm:grid-cols-2">
          <h2 className="text-lg font-semibold sm:col-span-2">{t('sales')}</h2>
          {field('sales.requiredDepositPercent', t('requiredDepositPercent'), (id, aria) => (
            <Input
              {...aria}
              type="number"
              min={0}
              max={100}
              step="any"
              {...register('sales.requiredDepositPercent', { valueAsNumber: true })}
            />
          ))}
          {field('sales.discountOverLimit', t('discountOverLimit'), (id, aria) => (
            <Select {...aria} {...register('sales.discountOverLimit')}>
              <option value="REJECT">{t('discountReject')}</option>
              <option value="APPROVAL">{t('discountApproval')}</option>
            </Select>
          ))}
        </Card>

        <Card className="grid gap-4 sm:grid-cols-2">
          <h2 className="text-lg font-semibold sm:col-span-2">{t('documents')}</h2>
          {field('documents.receiptPaper', t('receiptPaper'), (id, aria) => (
            <Select {...aria} {...register('documents.receiptPaper')}>
              <option value="58mm">58 mm</option>
              <option value="80mm">80 mm</option>
              <option value="A4">A4</option>
            </Select>
          ))}
          {field('documents.quotationValidityDays', t('quotationValidityDays'), (id, aria) => (
            <Input
              {...aria}
              type="number"
              min={1}
              max={365}
              {...register('documents.quotationValidityDays', { valueAsNumber: true })}
            />
          ))}
          <div className="sm:col-span-2">
            {field('documents.receiptFooter', t('receiptFooter'), (id, aria) => (
              <Textarea {...aria} {...register('documents.receiptFooter')} />
            ))}
          </div>
          <div className="sm:col-span-2">
            {field('documents.quotationTerms', t('quotationTerms'), (id, aria) => (
              <Textarea {...aria} {...register('documents.quotationTerms')} />
            ))}
          </div>
          <div className="sm:col-span-2">
            {field('documents.invoiceTerms', t('invoiceTerms'), (id, aria) => (
              <Textarea {...aria} {...register('documents.invoiceTerms')} />
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" {...register('documents.showBankDetails')} />{' '}
            {t('showBankDetails')}
          </label>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t('numbering')}</h2>
          <p className="text-sm text-neutral-600">{t('numberingHint')}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-neutral-600">
                  <th className="py-1 pr-3 font-medium">{t('numbering')}</th>
                  <th className="py-1 pr-3 font-medium">{t('prefix')}</th>
                  <th className="py-1 pr-3 font-medium">{t('includeYear')}</th>
                  <th className="py-1 pr-3 font-medium">{t('padding')}</th>
                  <th className="py-1 font-medium">{t('exampleHeading')}</th>
                </tr>
              </thead>
              <tbody>
                {DOC_TYPES.map((type) => {
                  const value = numbering?.[type];
                  const label = t(`docTypes.${type}`);
                  const prefixError = errors.numbering?.[type]?.prefix?.message;
                  return (
                    <tr key={type} className="border-t border-neutral-100">
                      <td className="py-2 pr-3">{label}</td>
                      <td className="py-2 pr-3">
                        <Input
                          aria-label={`${label} ${t('prefix')}`}
                          aria-invalid={prefixError ? true : undefined}
                          className="w-28"
                          {...register(`numbering.${type}.prefix`)}
                        />
                        {prefixError ? (
                          <p role="alert" className="text-xs text-red-700">
                            {prefixError}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="checkbox"
                          aria-label={`${label} ${t('includeYear')}`}
                          {...register(`numbering.${type}.includeYear`)}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          aria-label={`${label} ${t('padding')}`}
                          className="w-20"
                          {...register(`numbering.${type}.padding`, { valueAsNumber: true })}
                        />
                      </td>
                      <td className="py-2 font-mono text-xs">
                        {value ? numberExample(value, year) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </fieldset>
    </FormShell>
  );
}
