'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { DynamicFields } from '@/components/dynamic-fields/dynamic-fields';
import { FormShell } from '@/components/forms/form-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/errors';
import { useFieldsQuery, useUnitsQuery } from '@/lib/hooks/use-catalog';
import {
  useStaffQuery,
  type Address,
  type CustomerView,
  type DuplicateCandidate,
} from '@/lib/hooks/use-crm';
import { usePermission } from '@/lib/session';

interface FormValues {
  fullName: string;
  phones: string;
  email: string;
  billingLine1: string;
  billingCity: string;
  shippingLine1: string;
  shippingCity: string;
  preferredChannel: string;
  tags: string;
  source: string;
  notes: string;
  assignedToId: string;
  customFields: Record<string, unknown>;
}

const CHANNELS = ['WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'PHONE', 'EMAIL', 'SMS'] as const;
const lines = (text: string) =>
  text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

const addressOf = (line1: string, city: string): Address | null =>
  line1.trim() || city.trim()
    ? { line1: line1.trim() || undefined, city: city.trim() || undefined }
    : null;

function defaults(c: CustomerView | null): FormValues {
  return {
    fullName: c?.fullName ?? '',
    phones: (c?.phones ?? []).join('\n'),
    email: c?.email ?? '',
    billingLine1: c?.billingAddress?.line1 ?? '',
    billingCity: c?.billingAddress?.city ?? '',
    shippingLine1: c?.shippingAddress?.line1 ?? '',
    shippingCity: c?.shippingAddress?.city ?? '',
    preferredChannel: c?.preferredChannel ?? '',
    tags: (c?.tags ?? []).join(', '),
    source: c?.source ?? '',
    notes: c?.notes ?? '',
    assignedToId: c?.assignedToId ?? '',
    customFields: c?.customFields ?? {},
  };
}

/** Create (customer = null) or edit a customer; possible duplicates are shown before saving (Requirement 8.2). */
export function CustomerForm({
  customer,
  onSaved,
}: {
  customer: CustomerView | null;
  onSaved?: (customer: CustomerView) => void;
}) {
  const t = useTranslations('customers.form');
  const td = useTranslations('customers.duplicate');
  const router = useRouter();
  const queryClient = useQueryClient();
  const canEdit = usePermission(customer ? 'customer:edit' : 'customer:create');
  const canSeeStaff = usePermission('user:view');
  const staff = useStaffQuery(canSeeStaff);
  const fields = useFieldsQuery('CUSTOMER');
  const units = useUnitsQuery();
  const [notice, setNotice] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<DuplicateCandidate[] | null>(null);
  const form = useForm<FormValues>({ defaultValues: defaults(customer) });
  const { errors } = form.formState;
  const values = form.watch();
  const customErrors = Object.fromEntries(
    Object.entries(errors.customFields ?? {}).map(([k, v]) => [
      k,
      (v as { message?: string } | undefined)?.message,
    ]),
  );

  async function submit(v: FormValues, confirmDuplicate = false) {
    setNotice(null);
    const body: Record<string, unknown> = {
      fullName: v.fullName.trim(),
      phones: lines(v.phones),
      email: v.email.trim() || null,
      billingAddress: addressOf(v.billingLine1, v.billingCity),
      shippingAddress: addressOf(v.shippingLine1, v.shippingCity),
      preferredChannel: v.preferredChannel || null,
      tags: lines(v.tags),
      source: v.source.trim() || null,
      notes: v.notes.trim() || null,
      customFields: v.customFields,
      ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
      ...(canSeeStaff ? { assignedToId: v.assignedToId || null } : {}),
    };
    try {
      const saved = customer
        ? await api.patch<CustomerView>(`/customers/${customer.id}`, {
            ...body,
            version: customer.version,
          })
        : await api.post<CustomerView>('/customers', body);
      setCandidates(null);
      await queryClient.invalidateQueries({ queryKey: ['list', 'customers'] });
      await queryClient.invalidateQueries({ queryKey: ['customer'] });
      if (customer) {
        form.reset(defaults(saved));
        setNotice(t('saved'));
        onSaved?.(saved);
      } else {
        router.push(`/customers/${saved.id}`);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'POSSIBLE_DUPLICATE' && error.data) {
        setCandidates((error.data as { candidates: DuplicateCandidate[] }).candidates);
        return;
      }
      throw error;
    }
  }

  const err = (n: keyof FormValues) => errors[n]?.message as string | undefined;
  const text = (
    name: Exclude<keyof FormValues, 'customFields'>,
    label: string,
    extra: { required?: boolean; type?: string } = {},
  ) => (
    <Field id={`customer-${name}`} label={label} error={err(name)} required={extra.required}>
      <Input
        {...describedBy(`customer-${name}`, { error: err(name) })}
        type={extra.type}
        disabled={!canEdit}
        {...form.register(
          name,
          extra.required ? { validate: (v) => String(v).trim() !== '' || ' ' } : undefined,
        )}
      />
    </Field>
  );

  return (
    <div className="flex flex-col gap-4">
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {candidates ? (
        <Alert tone="info" className="flex flex-col gap-2" aria-labelledby="duplicate-title">
          <p id="duplicate-title" className="font-medium">
            {td('title')}
          </p>
          <p>{td('intro')}</p>
          <ul className="flex flex-col gap-1">
            {candidates.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.fullName}</span>
                <span className="text-xs">
                  {[c.phones[0], c.email].filter(Boolean).join(' · ')} (
                  {c.reasons.map((r) => td(`reasons.${r}`)).join(', ')})
                </span>
                <Link href={`/customers/${c.id}`} className="underline">
                  {td('open')}
                  <span className="sr-only"> {c.fullName}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void form.handleSubmit((v) => submit(v, true))()}
            >
              {td('saveAnyway')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setCandidates(null)}>
              {td('cancel')}
            </Button>
          </div>
        </Alert>
      ) : null}

      <FormShell
        form={form}
        onSubmit={(v) => submit(v)}
        submitLabel={customer ? t('save') : t('create')}
        hideSubmit={!canEdit}
        className="flex flex-col gap-6"
      >
        <section className="grid gap-3 sm:grid-cols-2" aria-labelledby="customer-identity">
          <h2 id="customer-identity" className="font-medium sm:col-span-2">
            {t('identity')}
          </h2>
          {text('fullName', t('fullName'), { required: true })}
          {text('email', t('email'), { type: 'email' })}
          <div className="sm:col-span-2">
            <Field
              id="customer-phones"
              label={t('phones')}
              hint={t('phonesHint')}
              error={err('phones')}
            >
              <Textarea
                {...describedBy('customer-phones', { hint: true, error: err('phones') })}
                disabled={!canEdit}
                {...form.register('phones')}
              />
            </Field>
          </div>
          <Field id="customer-channel" label={t('preferredChannel')}>
            <Select
              id="customer-channel"
              disabled={!canEdit}
              {...form.register('preferredChannel')}
            >
              <option value="" />
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`channels.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
          {text('source', t('source'))}
          {canSeeStaff ? (
            <Field id="customer-assigned" label={t('assigned')}>
              <Select id="customer-assigned" disabled={!canEdit} {...form.register('assignedToId')}>
                <option value="" />
                {(staff.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.firstName} {s.lastName}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {text('tags', t('tags'))}
        </section>

        <section className="grid gap-3 sm:grid-cols-2" aria-labelledby="customer-addresses">
          <h2 id="customer-addresses" className="sr-only">
            {t('billing')}
          </h2>
          {text('billingLine1', `${t('billing')}: ${t('line1')}`)}
          {text('billingCity', `${t('billing')}: ${t('city')}`)}
          {text('shippingLine1', `${t('shipping')}: ${t('line1')}`)}
          {text('shippingCity', `${t('shipping')}: ${t('city')}`)}
        </section>

        {(fields.data ?? []).length > 0 ? (
          <section className="grid gap-3 sm:grid-cols-2" aria-labelledby="customer-attributes">
            <h2 id="customer-attributes" className="font-medium sm:col-span-2">
              {t('attributes')}
            </h2>
            <DynamicFields
              definitions={fields.data ?? []}
              values={values.customFields}
              onChange={(next) => form.setValue('customFields', next, { shouldDirty: true })}
              errors={customErrors}
              units={units.data}
              disabled={!canEdit}
              idPrefix="customer-cf"
            />
          </section>
        ) : null}

        <Field id="customer-notes" label={t('notes')} error={err('notes')}>
          <Textarea
            {...describedBy('customer-notes', { error: err('notes') })}
            disabled={!canEdit}
            {...form.register('notes')}
          />
        </Field>
      </FormShell>
    </div>
  );
}
