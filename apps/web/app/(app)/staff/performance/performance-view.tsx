'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useErrorMessage } from '@/lib/error-message';
import { formatMoney } from '@/lib/format';
import { usePerformance } from '@/lib/hooks/use-commissions';
import { useStaffQuery } from '@/lib/hooks/use-crm';
import { usePermission, useSession, useWorkspaceLocale } from '@/lib/session';

/** A salesperson's results over a date range (Requirement 41.6); anyone else's need `commission:view_all`. */
export function PerformanceView() {
  const t = useTranslations('staff.performance');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const me = useSession();
  const seesAll = usePermission('commission:view_all');
  const canSeeStaff = usePermission('user:view');
  const staff = useStaffQuery(seesAll && canSeeStaff).data ?? [];
  const [userId, setUserId] = useState(me.user.id);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const result = usePerformance(
    userId,
    from ? new Date(`${from}T00:00:00Z`).toISOString() : '',
    to ? new Date(`${to}T23:59:59Z`).toISOString() : '',
  );
  const p = result.data;
  const card = (label: string, value: string) => (
    <div className="rounded border border-neutral-200 p-3">
      <dt className="text-sm text-neutral-600">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        {seesAll && staff.length > 0 ? (
          <Field id="perf-person" label={t('person')}>
            <Select id="perf-person" value={userId} onChange={(e) => setUserId(e.target.value)}>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.firstName} {s.lastName}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field id="perf-from" label={t('from')}>
          <Input
            id="perf-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field id="perf-to" label={t('to')}>
          <Input id="perf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {result.isError ? <Alert>{message(result.error)}</Alert> : null}
      {result.isPending ? <p role="status">…</p> : null}
      {p ? (
        <dl className="grid gap-3 sm:grid-cols-3">
          {card(t('leadsAssigned'), String(p.leadsAssigned))}
          {card(t('leadsWon'), String(p.leadsWon))}
          {card(t('conversion'), `${p.conversionRate}%`)}
          {card(t('orders'), String(p.orders))}
          {card(t('salesValue'), formatMoney(p.salesValue, locale))}
          {card(t('averageOrder'), formatMoney(p.averageOrderValue, locale))}
          {card(t('pending'), formatMoney(p.commissionsPending, locale))}
          {card(t('approved'), formatMoney(p.commissionsApproved, locale))}
          {card(t('paid'), formatMoney(p.commissionsPaid, locale))}
        </dl>
      ) : null}
    </div>
  );
}
