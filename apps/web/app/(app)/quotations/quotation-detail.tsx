'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { NotesPanel } from '@/components/crm/notes-panel';
import { TasksPanel } from '@/components/crm/tasks-panel';
import { FileUpload } from '@/components/forms/file-upload';
import { LinesTable } from '@/components/sales/lines-table';
import { TotalsPanel } from '@/components/sales/line-editor';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatDate } from '@/lib/format';
import type { OrderView, QuotationView } from '@/lib/hooks/use-sales';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { useTerminology } from '@/lib/terminology';
import { QuotationForm } from './quotation-form';
import { STATUS_COLORS } from './quotation-list';

type Dialog = 'accept' | 'reject' | null;

/** One quotation: send, record the customer's answer, convert to an order, open the PDF (Requirements 10, 39.4). */
export function QuotationDetail({ quotationId }: { quotationId: string }) {
  const t = useTranslations('sales.quotation.detail');
  const ts = useTranslations('sales.quotation.status');
  const message = useErrorMessage();
  const term = useTerminology();
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canEdit = usePermission('quotation:edit');
  const canSend = usePermission('quotation:send');
  const canConvert = usePermission('order:create');
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const [via, setVia] = useState<'IN_PERSON' | 'MESSAGE' | 'PHONE'>('IN_PERSON');
  const [proofId, setProofId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const quotation = useQuery({
    queryKey: ['quotation', quotationId],
    queryFn: ({ signal }) =>
      api.get<QuotationView>(`/quotations/${quotationId}`, undefined, signal),
  });
  const q = quotation.data;
  const customer = useQuery({
    queryKey: ['customer', q?.customerId],
    enabled: !!q?.customerId,
    queryFn: ({ signal }) =>
      api.get<{ id: string; fullName: string }>(`/customers/${q?.customerId}`, undefined, signal),
  });

  if (quotation.isPending) return <p role="status">…</p>;
  if (quotation.isError) return <Alert>{message(quotation.error)}</Alert>;
  const view = quotation.data;

  async function act(path: string, body: object = {}) {
    setError(null);
    try {
      const result = await api.post<unknown>(`/quotations/${quotationId}/${path}`, body);
      await queryClient.invalidateQueries({ queryKey: ['quotation'] });
      await queryClient.invalidateQueries({ queryKey: ['quotations'] });
      setDialog(null);
      return result;
    } catch (e) {
      setError(message(e));
      return undefined;
    }
  }

  async function convert() {
    const result = (await act('convert')) as { order: OrderView } | undefined;
    if (result) router.push(`/orders/${result.order.id}`);
  }

  const editable = view.status === 'DRAFT' || view.status === 'SENT';
  const totals = {
    subtotal: view.subtotal,
    discountAmount: view.discountAmount,
    taxAmount: view.taxAmount,
    roundingAmount: '0',
    total: view.totalAmount,
  };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <Link href="/quotations" className="text-sm underline">
          {t('back')}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{view.quotationNumber}</h1>
          <StatusBadge label={ts(view.status)} color={STATUS_COLORS[view.status]} />
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          {customer.data ? (
            <Link href={`/customers/${customer.data.id}`} className="underline">
              {customer.data.fullName}
            </Link>
          ) : null}
          {view.validUntil
            ? ` · ${t('validUntil', { date: formatDate(view.validUntil, locale) })}`
            : ''}
        </p>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {view.status === 'REJECTED' && view.rejectedReason ? (
        <Alert tone="info">{t('rejectedBecause', { reason: view.rejectedReason })}</Alert>
      ) : null}
      {view.acceptedAt ? (
        <Alert tone="success">
          {t('acceptedOn', {
            date: formatDate(view.acceptedAt, locale),
            via: view.acceptedVia ? t(`via.${view.acceptedVia}`) : '',
          })}
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <a href={`/api/bff/quotations/${view.id}/pdf`} target="_blank" rel="noreferrer">
            {t('openPdf')}
          </a>
        </Button>
        {canEdit && editable ? (
          <Button type="button" variant="outline" onClick={() => setEditing((v) => !v)}>
            {editing ? t('cancelEdit') : t('edit')}
          </Button>
        ) : null}
        {canSend && editable ? (
          <Button type="button" onClick={() => void act('send')}>
            {view.status === 'SENT' ? t('resend') : t('send')}
          </Button>
        ) : null}
        {canEdit && view.status === 'SENT' ? (
          <Button type="button" onClick={() => setDialog('accept')}>
            {t('accept')}
          </Button>
        ) : null}
        {canEdit && editable ? (
          <Button type="button" variant="outline" onClick={() => setDialog('reject')}>
            {t('reject')}
          </Button>
        ) : null}
        {canConvert && view.status === 'ACCEPTED' ? (
          <Button type="button" onClick={() => void convert()}>
            {t('convert', { order: term('order').toLowerCase() })}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <QuotationForm
          quotation={view}
          onSaved={() => setEditing(false)}
          customer={customer.data ?? null}
        />
      ) : (
        <>
          <LinesTable lines={view.items ?? []} />
          <TotalsPanel totals={totals} />
          {view.notes ? (
            <section>
              <h2 className="font-medium">{t('notes')}</h2>
              <p className="whitespace-pre-line text-sm">{view.notes}</p>
            </section>
          ) : null}
          {view.terms ? (
            <section>
              <h2 className="font-medium">{t('terms')}</h2>
              <p className="whitespace-pre-line text-sm">{view.terms}</p>
            </section>
          ) : null}
        </>
      )}

      <NotesPanel entityType="QUOTATION" entityId={view.id} canWrite={canEdit} />
      <TasksPanel entityType="QUOTATION" entityId={view.id} />

      <Modal open={dialog === 'accept'} title={t('acceptTitle')} onClose={() => setDialog(null)}>
        <div className="flex flex-col gap-3">
          <Field id="accept-via" label={t('acceptVia')}>
            <Select
              id="accept-via"
              value={via}
              onChange={(e) => setVia(e.target.value as typeof via)}
            >
              {(['IN_PERSON', 'MESSAGE', 'PHONE'] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`via.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          <FileUpload label={t('proof')} onUploaded={(f) => setProofId(f.id)} />
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => void act('accept', { via, ...(proofId ? { fileId: proofId } : {}) })}
            >
              {t('recordAcceptance')}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal open={dialog === 'reject'} title={t('rejectTitle')} onClose={() => setDialog(null)}>
        <div className="flex flex-col gap-3">
          <Field id="reject-reason" label={t('rejectReason')} required>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={reason.trim() === ''}
              onClick={() => void act('reject', { reason: reason.trim() })}
            >
              {t('confirmReject')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
