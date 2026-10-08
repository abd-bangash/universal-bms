'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { FormShell } from '@/components/forms/form-shell';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { usePermission } from '@/lib/session';

interface Unit {
  id: string;
  name: string;
  symbol: string;
  dimension: string;
  toBase: string;
}
interface UnitForm {
  name: string;
  symbol: string;
  dimension: string;
  toBase: string;
}

const DIMENSIONS = ['count', 'weight', 'length', 'area', 'volume', 'time'] as const;

export function UnitsPanel() {
  const t = useTranslations('settings.industry');
  const message = useErrorMessage();
  const canConfigure = usePermission('workspace:configure');
  const queryClient = useQueryClient();
  const units = useQuery({
    queryKey: ['units'],
    queryFn: () => api.get<Unit[]>('/settings/units'),
  });
  const form = useForm<UnitForm>({
    defaultValues: { name: '', symbol: '', dimension: 'length', toBase: '1' },
  });
  const { errors } = form.formState;

  const create = useMutation({
    mutationFn: (values: UnitForm) => api.post<Unit>('/settings/units', values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['units'] }),
  });
  const grouped = useMemo(() => units.data ?? [], [units.data]);

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('units')}</h2>
      {units.isError ? <Alert>{message(units.error)}</Alert> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('units')}</caption>
          <thead>
            <tr className="text-left text-xs uppercase text-neutral-600">
              <th scope="col" className="py-1 pr-3 font-medium">
                {t('unitName')}
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                {t('unitSymbol')}
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                {t('unitDimension')}
              </th>
              <th scope="col" className="py-1 font-medium">
                {t('unitFactor')}
              </th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((u) => (
              <tr key={u.id} className="border-t border-neutral-100">
                <td className="py-1 pr-3">{u.name}</td>
                <td className="py-1 pr-3 font-mono">{u.symbol}</td>
                <td className="py-1 pr-3">{t(`dimensions.${u.dimension}`)}</td>
                <td className="py-1 font-mono tabular-nums">{u.toBase}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canConfigure ? (
        <FormShell
          form={form}
          submitLabel={t('addUnit')}
          successMessage={t('unitAdded')}
          className="grid gap-3 sm:grid-cols-4 sm:items-end"
          onSubmit={async (values) => {
            await create.mutateAsync(values);
            form.reset({ name: '', symbol: '', dimension: values.dimension, toBase: '1' });
          }}
        >
          <Field id="unit-name" label={t('unitName')} error={errors.name?.message}>
            <Input
              {...describedBy('unit-name', { error: errors.name?.message })}
              {...form.register('name', { required: true })}
            />
          </Field>
          <Field id="unit-symbol" label={t('unitSymbol')} error={errors.symbol?.message}>
            <Input
              {...describedBy('unit-symbol', { error: errors.symbol?.message })}
              maxLength={12}
              {...form.register('symbol', { required: true })}
            />
          </Field>
          <Field id="unit-dimension" label={t('unitDimension')}>
            <Select id="unit-dimension" {...form.register('dimension')}>
              {DIMENSIONS.map((d) => (
                <option key={d} value={d}>
                  {t(`dimensions.${d}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="unit-factor" label={t('unitFactor')} error={errors.toBase?.message}>
            <Input
              {...describedBy('unit-factor', { error: errors.toBase?.message })}
              inputMode="decimal"
              {...form.register('toBase', { required: true })}
            />
          </Field>
        </FormShell>
      ) : null}
    </Card>
  );
}
