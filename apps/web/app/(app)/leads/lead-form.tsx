'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { DynamicFields } from '@/components/dynamic-fields/dynamic-fields';
import { FormShell } from '@/components/forms/form-shell';
import { MoneyInput } from '@/components/forms/money-input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { useFieldsQuery, useUnitsQuery } from '@/lib/hooks/use-catalog';
import { useStaffQuery, type LeadView } from '@/lib/hooks/use-crm';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { useTerminology } from '@/lib/terminology';

interface FormValues {
  fullName: string;
  phone: string;
  email: string;
  source: string;
  channel: string;
  campaign: string;
  interest: string;
  requirements: string;
  quantity: string;
  estimatedValue: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  nextAction: string;
  nextActionDate: string;
  assignedToId: string;
  customFields: Record<string, unknown>;
}

const SOURCES = ['MESSAGING', 'SOCIAL', 'STORE', 'WEBSITE', 'MANUAL', 'IMPORT'] as const;

/** An ISO instant as the value of a `datetime-local` input (the browser's local time). */
const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function defaults(l: LeadView | null): FormValues {
  return {
    fullName: l?.fullName ?? '',
    phone: l?.phone ?? '',
    email: l?.email ?? '',
    source: l?.source ?? 'MANUAL',
    channel: l?.channel ?? '',
    campaign: l?.campaign ?? '',
    interest: l?.interest ?? '',
    requirements: l?.requirements ?? '',
    quantity: l?.quantity ?? '',
    estimatedValue: l?.estimatedValue ?? '',
    priority: l?.priority ?? 'MEDIUM',
    nextAction: l?.nextAction ?? '',
    nextActionDate: toLocalInput(l?.nextActionDate ?? null),
    assignedToId: l?.assignedToId ?? '',
    customFields: l?.customFields ?? {},
  };
}

/** Create (lead = null) or edit a lead. Creating returns the open lead instead when the contact is a repeat (Requirement 9.7). */
export function LeadForm({
  lead,
  onSaved,
}: {
  lead: LeadView | null;
  onSaved?: (lead: LeadView) => void;
}) {
  const t = useTranslations('leads.form');
  const te = useTranslations('leads.existing');
  const tp = useTranslations('crm.priority');
  const term = useTerminology();
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = useWorkspaceLocale();
  const canEdit = usePermission(lead ? 'lead:edit' : 'lead:create');
  const canAssign = usePermission('lead:assign');
  const canSeeStaff = usePermission('user:view');
  const staff = useStaffQuery(canAssign && canSeeStaff);
  const fields = useFieldsQuery('LEAD');
  const units = useUnitsQuery();
  const [notice, setNotice] = useState<string | null>(null);
  const [existing, setExisting] = useState<LeadView | null>(null);
  const form = useForm<FormValues>({ defaultValues: defaults(lead) });
  const { errors } = form.formState;
  const values = form.watch();
  const customErrors = Object.fromEntries(
    Object.entries(errors.customFields ?? {}).map(([k, v]) => [
      k,
      (v as { message?: string } | undefined)?.message,
    ]),
  );

  async function submit(v: FormValues, allowDuplicate = false) {
    setNotice(null);
    const nullable = (s: string) => (s.trim() === '' ? null : s.trim());
    const body: Record<string, unknown> = {
      fullName: v.fullName.trim(),
      phone: nullable(v.phone),
      email: nullable(v.email),
      source: v.source || null,
      channel: nullable(v.channel),
      campaign: nullable(v.campaign),
      interest: nullable(v.interest),
      requirements: nullable(v.requirements),
      quantity: v.quantity === '' ? null : v.quantity,
      estimatedValue: v.estimatedValue === '' ? null : v.estimatedValue,
      priority: v.priority,
      nextAction: nullable(v.nextAction),
      nextActionDate: v.nextActionDate === '' ? null : new Date(v.nextActionDate).toISOString(),
      customFields: v.customFields,
    };
    if (!lead && canAssign && v.assignedToId) body.assignedToId = v.assignedToId;
    if (!lead && allowDuplicate) body.allowDuplicate = true;

    if (lead) {
      const saved = await api.patch<LeadView>(`/leads/${lead.id}`, {
        ...body,
        version: lead.version,
      });
      form.reset(defaults(saved));
      setNotice(t('saved'));
      await queryClient.invalidateQueries({ queryKey: ['lead'] });
      await queryClient.invalidateQueries({ queryKey: ['pipeline'] });
      await queryClient.invalidateQueries({ queryKey: ['timeline'] });
      onSaved?.(saved);
      return;
    }
    const created = await api.post<LeadView & { existing: boolean }>('/leads', body);
    if (created.existing) {
      setExisting(created);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['pipeline'] });
    router.push(`/leads/${created.id}`);
  }

  const err = (n: keyof FormValues) => errors[n]?.message as string | undefined;
  const text = (
    name: Exclude<keyof FormValues, 'customFields'>,
    label: string,
    opts: { required?: boolean; type?: string } = {},
  ) => (
    <Field id={`lead-${name}`} label={label} error={err(name)} required={opts.required}>
      <Input
        {...describedBy(`lead-${name}`, { error: err(name) })}
        type={opts.type}
        disabled={!canEdit}
        {...form.register(
          name,
          opts.required ? { validate: (x) => String(x).trim() !== '' || ' ' } : undefined,
        )}
      />
    </Field>
  );

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {!lead ? (
        <h1 className="text-2xl font-semibold">
          {t('title', { lead: term('lead').toLowerCase() })}
        </h1>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {existing ? (
        <Alert tone="info" className="flex flex-col gap-2">
          <p className="font-medium">{te('title')}</p>
          <p>{te('description', { name: existing.fullName })}</p>
          <div className="flex gap-2">
            <Button asChild size="sm">
              <Link href={`/leads/${existing.id}`}>{te('open')}</Link>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void form.handleSubmit((v) => submit(v, true))()}
            >
              {te('createAnyway')}
            </Button>
          </div>
        </Alert>
      ) : null}

      <FormShell
        form={form}
        onSubmit={(v) => submit(v)}
        submitLabel={lead ? t('save') : t('create')}
        hideSubmit={!canEdit}
        className="flex flex-col gap-6"
      >
        <section className="grid gap-3 sm:grid-cols-2" aria-labelledby="lead-contact">
          <h2 id="lead-contact" className="font-medium sm:col-span-2">
            {t('contact')}
          </h2>
          {text('fullName', t('fullName'), { required: true })}
          {text('phone', t('phone'), { type: 'tel' })}
          {text('email', t('email'), { type: 'email' })}
          <Field id="lead-source" label={t('source')}>
            <Select id="lead-source" disabled={!canEdit} {...form.register('source')}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`sources.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          {text('channel', t('channel'))}
          {text('campaign', t('campaign'))}
        </section>

        <section className="grid gap-3 sm:grid-cols-2" aria-labelledby="lead-requirements">
          <h2 id="lead-requirements" className="font-medium sm:col-span-2">
            {t('requirementsHeading')}
          </h2>
          <div className="sm:col-span-2">{text('interest', t('interest'))}</div>
          <div className="sm:col-span-2">
            <Field
              id="lead-requirements-text"
              label={t('requirements')}
              error={err('requirements')}
            >
              <Textarea
                {...describedBy('lead-requirements-text', { error: err('requirements') })}
                disabled={!canEdit}
                {...form.register('requirements')}
              />
            </Field>
          </div>
          <Field id="lead-quantity" label={t('quantity')} error={err('quantity')}>
            <Controller
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <MoneyInput
                  {...describedBy('lead-quantity', { error: err('quantity') })}
                  value={field.value}
                  onChange={field.onChange}
                  decimals={0}
                  disabled={!canEdit}
                />
              )}
            />
          </Field>
          <Field id="lead-estimatedValue" label={t('estimatedValue')} error={err('estimatedValue')}>
            <Controller
              control={form.control}
              name="estimatedValue"
              render={({ field }) => (
                <MoneyInput
                  {...describedBy('lead-estimatedValue', { error: err('estimatedValue') })}
                  value={field.value}
                  onChange={field.onChange}
                  decimals={locale.currencyDecimals}
                  disabled={!canEdit}
                />
              )}
            />
          </Field>
          <DynamicFields
            definitions={fields.data ?? []}
            values={values.customFields}
            onChange={(next) => form.setValue('customFields', next, { shouldDirty: true })}
            errors={customErrors}
            units={units.data}
            currencyDecimals={locale.currencyDecimals}
            disabled={!canEdit}
            idPrefix="lead-cf"
          />
        </section>

        <section className="grid gap-3 sm:grid-cols-2" aria-labelledby="lead-pipeline">
          <h2 id="lead-pipeline" className="font-medium sm:col-span-2">
            {t('pipeline')}
          </h2>
          <Field id="lead-priority" label={t('priority')}>
            <Select id="lead-priority" disabled={!canEdit} {...form.register('priority')}>
              {(['LOW', 'MEDIUM', 'HIGH'] as const).map((p) => (
                <option key={p} value={p}>
                  {tp(p)}
                </option>
              ))}
            </Select>
          </Field>
          {!lead && canAssign && canSeeStaff ? (
            <Field id="lead-assigned" label={t('assigned')}>
              <Select id="lead-assigned" {...form.register('assignedToId')}>
                <option value="" />
                {(staff.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.firstName} {s.lastName}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {text('nextAction', t('nextAction'))}
          {text('nextActionDate', t('nextActionDate'), { type: 'datetime-local' })}
        </section>
      </FormShell>
    </div>
  );
}
