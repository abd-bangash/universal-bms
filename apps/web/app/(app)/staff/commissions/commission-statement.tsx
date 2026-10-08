'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { DataTable, type Column, type FilterDefinition } from '@/components/data-table/data-table';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatDate, formatMoney } from '@/lib/format';
import {
  COMMISSION_COLORS,
  COMMISSION_STATUSES,
  type CommissionView,
} from '@/lib/hooks/use-commissions';
import { useStaffQuery } from '@/lib/hooks/use-crm';
import { usePermission, useWorkspaceLocale } from '@/lib/session';

/** The commission statement: who earned what on which order, with approval and payment (Requirements 14.4, 14.5, 14.7). */
export function CommissionStatement() {
  const t = useTranslations('staff.statement');
  const ts = useTranslations('staff.statement.status');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const canApprove = usePermission('commission:approve');
  const canPay = usePermission('commission:pay');
  const seesAll = usePermission('commission:view_all');
  const canSeeStaff = usePermission('user:view');
  const staff = useStaffQuery(seesAll && canSeeStaff).data ?? [];
  const [paying, setPaying] = useState<CommissionView | null>(null);
  const [method, setMethod] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, action: 'approve' | 'reject' | 'pay', body: object = {}) {
    setError(null);
    setBusy(id);
    try {
      await api.post(`/commissions/${id}/${action}`, body);
      await queryClient.invalidateQueries({ queryKey: ['list', 'commissions'] });
      setPaying(null);
      setMethod('');
      setPaidOn('');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  const columns: Array<Column<CommissionView>> = [
    {
      key: 'order',
      header: t('order'),
      cell: (c) => (
        <Link className="font-medium underline" href={`/orders/${c.orderId}`}>
          {c.orderNumber}
        </Link>
      ),
    },
    { key: 'person', header: t('salesperson'), cell: (c) => c.salespersonName },
    { key: 'rule', header: t('rule'), cell: (c) => c.ruleName ?? '' },
    {
      key: 'base',
      header: t('base'),
      className: 'text-right',
      cell: (c) => <span className="tabular-nums">{formatMoney(c.calculationBase, locale)}</span>,
    },
    {
      key: 'amount',
      header: t('amount'),
      className: 'text-right',
      cell: (c) => <span className="tabular-nums">{formatMoney(c.amount, locale)}</span>,
    },
    {
      key: 'status',
      header: t('statusLabel'),
      cell: (c) => <StatusBadge label={ts(c.status)} color={COMMISSION_COLORS[c.status]} />,
    },
    {
      key: 'date',
      header: t('date'),
      cell: (c) => formatDate(c.paidAt ?? c.createdAt, locale),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('actions')}</span>,
      cell: (c) => (
        <div className="flex gap-1">
          {canApprove && c.status === 'PENDING' ? (
            <>
              <Button
                type="button"
                size="sm"
                disabled={busy === c.id}
                aria-label={t('approveLabel', { order: c.orderNumber })}
                onClick={() => void run(c.id, 'approve')}
              >
                {t('approve')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy === c.id}
                aria-label={t('rejectLabel', { order: c.orderNumber })}
                onClick={() => void run(c.id, 'reject')}
              >
                {t('reject')}
              </Button>
            </>
          ) : null}
          {canPay && c.status === 'APPROVED' ? (
            <Button
              type="button"
              size="sm"
              disabled={busy === c.id}
              aria-label={t('payLabel', { order: c.orderNumber })}
              onClick={() => setPaying(c)}
            >
              {t('markPaid')}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];
  const filters: FilterDefinition[] = [
    {
      key: 'status',
      label: t('filterStatus'),
      options: COMMISSION_STATUSES.map((s) => ({ value: s, label: ts(s) })),
    },
    ...(seesAll && staff.length > 0
      ? [
          {
            key: 'salespersonId',
            label: t('salesperson'),
            options: staff.map((s) => ({ value: s.id, label: `${s.firstName} ${s.lastName}` })),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {!seesAll ? <p className="text-sm text-neutral-600">{t('onlyMine')}</p> : null}
      {error ? <Alert>{error}</Alert> : null}
      <DataTable<CommissionView>
        queryKey="commissions"
        endpoint="/commissions"
        caption={t('caption')}
        columns={columns}
        rowKey={(c) => c.id}
        filters={filters}
        searchable={false}
        emptyTitle={t('empty')}
        emptyDescription={t('emptyDescription')}
      />
      {paying ? (
        <Modal open title={t('payTitle')} onClose={() => setPaying(null)}>
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {t('payFor', {
                amount: formatMoney(paying.amount, locale),
                person: paying.salespersonName,
              })}
            </p>
            <Field id="pay-method" label={t('method')} required>
              <Input
                id="pay-method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                list="commission-methods"
              />
              <datalist id="commission-methods">
                <option value="Cash" />
                <option value="Bank transfer" />
                <option value="With salary" />
              </datalist>
            </Field>
            <Field id="pay-date" label={t('paidOn')}>
              <Input
                id="pay-date"
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPaying(null)}>
                {t('cancel')}
              </Button>
              <Button
                type="button"
                disabled={method.trim() === '' || busy === paying.id}
                onClick={() =>
                  void run(paying.id, 'pay', {
                    method: method.trim(),
                    ...(paidOn ? { paidAt: new Date(`${paidOn}T12:00:00Z`).toISOString() } : {}),
                  })
                }
              >
                {t('confirmPaid')}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
