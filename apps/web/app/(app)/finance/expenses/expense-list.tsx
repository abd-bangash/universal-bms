'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { DataTable, type Column, type FilterDefinition } from '@/components/data-table/data-table';
import { FileUpload } from '@/components/forms/file-upload';
import { MoneyInput } from '@/components/forms/money-input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatDate, formatMoney } from '@/lib/format';
import { useExpenseCategories, usePaymentMethods, type ExpenseView } from '@/lib/hooks/use-finance';
import { usePermission, useWorkspaceLocale } from '@/lib/session';

const today = () => new Date().toISOString().slice(0, 10);

function NewExpenseDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('finance.expenses.form');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const categories = useExpenseCategories().data ?? [];
  const methods = usePaymentMethods().data ?? [];
  const [categoryId, setCategoryId] = useState('');
  const [methodId, setMethodId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [fileId, setFileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await api.post('/expenses', {
        categoryId,
        paymentMethodId: methodId,
        amount,
        expenseDate: date,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(fileId ? { attachmentFileId: fileId } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ['list', 'expenses'] });
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={t('title')} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}
        <Field id="exp-category" label={t('category')} required>
          <Select
            id="exp-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="" />
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="exp-amount" label={t('amount')} required>
          <MoneyInput
            id="exp-amount"
            value={amount}
            onChange={setAmount}
            decimals={locale.currencyDecimals}
          />
        </Field>
        <Field id="exp-date" label={t('date')} required>
          <Input id="exp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="exp-method" label={t('method')} required>
          <Select id="exp-method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
            <option value="" />
            {methods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="exp-description" label={t('description')}>
          <Textarea
            id="exp-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <FileUpload label={t('attachment')} onUploaded={(f) => setFileId(f.id)} />
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={saving || !categoryId || !methodId || !(Number(amount) > 0) || !date}
            onClick={() => void save()}
          >
            {saving ? t('saving') : t('save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function VoidButton({ expense }: { expense: ExpenseView }) {
  const t = useTranslations('finance.expenses');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const canVoid = usePermission('expense:void');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!canVoid || expense.status !== 'POSTED') return null;

  async function run() {
    setError(null);
    try {
      await api.post(`/expenses/${expense.id}/void`, { reason: reason.trim() });
      setOpen(false);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['list', 'expenses'] });
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t('void')}
      </Button>
      <Modal open={open} title={t('voidTitle')} onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-3">
          {error ? <Alert>{error}</Alert> : null}
          <Field id={`void-${expense.id}`} label={t('reason')} required>
            <Textarea
              id={`void-${expense.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="button" disabled={reason.trim() === ''} onClick={() => void run()}>
              {t('confirmVoid')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function ExpenseList() {
  const t = useTranslations('finance.expenses');
  const locale = useWorkspaceLocale();
  const canCreate = usePermission('expense:create');
  const categories = useExpenseCategories(true).data ?? [];
  const [adding, setAdding] = useState(false);

  const columns: Array<Column<ExpenseView>> = [
    {
      key: 'date',
      header: t('date'),
      sortKey: 'expenseDate',
      cell: (e) => formatDate(e.expenseDate, locale),
    },
    {
      key: 'category',
      header: t('category'),
      cell: (e) => categories.find((c) => c.id === e.categoryId)?.name ?? '',
    },
    { key: 'description', header: t('description'), cell: (e) => e.description ?? '' },
    {
      key: 'amount',
      header: t('amount'),
      className: 'text-right',
      cell: (e) => <span className="tabular-nums">{formatMoney(e.amount, locale)}</span>,
    },
    {
      key: 'status',
      header: t('statusLabel'),
      cell: (e) => (
        <StatusBadge
          label={t(`status.${e.status}`)}
          color={e.status === 'POSTED' ? '#16a34a' : '#a3a3a3'}
        />
      ),
    },
    { key: 'actions', header: t('actions'), cell: (e) => <VoidButton expense={e} /> },
  ];
  const filters: FilterDefinition[] = [
    {
      key: 'categoryId',
      label: t('filterCategory'),
      options: categories.map((c) => ({ value: c.id, label: c.name })),
    },
    {
      key: 'status',
      label: t('filterStatus'),
      options: (['POSTED', 'VOIDED'] as const).map((s) => ({ value: s, label: t(`status.${s}`) })),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {canCreate ? (
          <Button type="button" onClick={() => setAdding(true)}>
            {t('add')}
          </Button>
        ) : null}
      </div>
      <DataTable<ExpenseView>
        queryKey="expenses"
        endpoint="/expenses"
        caption={t('caption')}
        columns={columns}
        rowKey={(e) => e.id}
        filters={filters}
        defaultSort="expenseDate:desc"
        emptyTitle={t('empty')}
        emptyDescription={t('emptyDescription')}
      />
      {adding ? <NewExpenseDialog onClose={() => setAdding(false)} /> : null}
    </div>
  );
}
