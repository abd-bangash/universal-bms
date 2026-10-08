'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import Decimal from 'decimal.js';
import { FormShell } from '@/components/forms/form-shell';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { usePermission } from '@/lib/session';

interface TaxClass {
  id: string;
  name: string;
  rate: string;
  active: boolean;
}
interface TaxForm {
  name: string;
  rate: string;
}

/** 0.1700 shown as 17%, computed with decimals (never floats). */
export function ratePercent(rate: string): string {
  return new Decimal(rate).times(100).toDecimalPlaces(2).toFixed();
}

export function TaxPanel() {
  const t = useTranslations('settings.industry');
  const message = useErrorMessage();
  const canConfigure = usePermission('workspace:configure');
  const queryClient = useQueryClient();
  const taxes = useQuery({
    queryKey: ['tax-classes'],
    queryFn: () => api.get<TaxClass[]>('/settings/tax-classes'),
  });
  const form = useForm<TaxForm>({ defaultValues: { name: '', rate: '' } });
  const { errors } = form.formState;

  const create = useMutation({
    mutationFn: (values: TaxForm) => api.post<TaxClass>('/settings/tax-classes', values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tax-classes'] }),
  });
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch<TaxClass>(`/settings/tax-classes/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tax-classes'] }),
  });

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('taxClasses')}</h2>
      {taxes.isError ? <Alert>{message(taxes.error)}</Alert> : null}
      {setActive.isError ? <Alert>{message(setActive.error)}</Alert> : null}
      {taxes.data?.length === 0 ? <p className="text-sm text-neutral-600">{t('none')}</p> : null}
      <ul className="flex flex-col gap-1">
        {taxes.data?.map((tax) => (
          <li
            key={tax.id}
            className="flex items-center justify-between gap-2 border-b border-neutral-100 py-1 text-sm"
          >
            <span>
              {tax.name} · {t('taxRatePercent', { percent: ratePercent(tax.rate) })}
            </span>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={tax.active}
                disabled={!canConfigure || setActive.isPending}
                aria-label={`${tax.name} ${t('taxActive')}`}
                onChange={(e) => setActive.mutate({ id: tax.id, active: e.target.checked })}
              />
              {t('taxActive')}
            </label>
          </li>
        ))}
      </ul>
      {canConfigure ? (
        <FormShell
          form={form}
          submitLabel={t('addTax')}
          successMessage={t('taxAdded')}
          className="grid gap-3 sm:grid-cols-3 sm:items-end"
          onSubmit={async (values) => {
            await create.mutateAsync(values);
            form.reset({ name: '', rate: '' });
          }}
        >
          <Field id="tax-name" label={t('taxName')} error={errors.name?.message}>
            <Input
              {...describedBy('tax-name', { error: errors.name?.message })}
              {...form.register('name', { required: true })}
            />
          </Field>
          <Field id="tax-rate" label={t('taxRate')} error={errors.rate?.message}>
            <Input
              {...describedBy('tax-rate', { error: errors.rate?.message })}
              inputMode="decimal"
              placeholder="0.1700"
              {...form.register('rate', { required: true })}
            />
          </Field>
        </FormShell>
      ) : null}
    </Card>
  );
}
