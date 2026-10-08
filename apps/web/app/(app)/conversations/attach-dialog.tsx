'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { FileUpload, type UploadedFile } from '@/components/forms/file-upload';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api-client';
import type { ConversationView } from '@/lib/hooks/use-conversations';
import { cn } from '@/lib/utils';

export interface AttachmentChoice {
  type: 'FILE' | 'QUOTATION' | 'INVOICE';
  id: string;
  caption?: string;
}

interface QuotationRow {
  id: string;
  quotationNumber: string;
  status: string;
  totalAmount: string;
}
interface OrderRow {
  id: string;
  orderNumber: string;
}
interface InvoiceRow {
  id: string;
  invoiceNumber: string;
}

type Tab = 'quotation' | 'invoice' | 'file';

/** Picks a quotation, an invoice or an uploaded file to send as a PDF or picture on this conversation. */
export function AttachDialog({
  open,
  onClose,
  conversation: c,
  busy,
  error,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  conversation: ConversationView;
  busy: boolean;
  error: string | null;
  onSend: (choice: AttachmentChoice) => Promise<boolean>;
}) {
  const t = useTranslations('conversations.attach');
  const [tab, setTab] = useState<Tab>('quotation');
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const linked = Boolean(c.customerId || c.leadId);
  const party = c.customerId ? { customerId: c.customerId } : { leadId: c.leadId ?? undefined };

  const quotations = useQuery({
    queryKey: ['conv-attach', 'quotations', c.customerId, c.leadId],
    enabled: open && tab === 'quotation' && linked,
    queryFn: ({ signal }) =>
      api.get<QuotationRow[]>('/quotations', { ...party, limit: 20 }, signal),
  });
  const orders = useQuery({
    queryKey: ['conv-attach', 'orders', c.customerId],
    enabled: open && tab === 'invoice' && Boolean(c.customerId),
    queryFn: ({ signal }) =>
      api.get<OrderRow[]>('/orders', { customerId: c.customerId, limit: 20 }, signal),
  });
  const invoices = useQuery({
    queryKey: ['conv-attach', 'invoices', orderId],
    enabled: open && tab === 'invoice' && Boolean(orderId),
    queryFn: ({ signal }) =>
      api.get<InvoiceRow[]>(`/orders/${orderId}/invoices`, undefined, signal),
  });

  const withCaption = (choice: AttachmentChoice): AttachmentChoice =>
    caption.trim() ? { ...choice, caption: caption.trim() } : choice;

  return (
    <Modal open={open} title={t('title')} onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <div
          role="tablist"
          aria-label={t('title')}
          className="flex gap-1 border-b border-neutral-200"
        >
          {(['quotation', 'invoice', 'file'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                'px-3 py-2 text-sm',
                tab === id ? 'border-b-2 border-neutral-900 font-medium' : 'text-neutral-600',
              )}
            >
              {t(id)}
            </button>
          ))}
        </div>
        {error ? <Alert>{error}</Alert> : null}
        {tab !== 'file' && !linked ? <Alert tone="info">{t('needsCustomer')}</Alert> : null}

        {tab === 'quotation' && linked ? (
          <ul aria-label={t('quotations')} className="flex flex-col gap-2">
            {(quotations.data ?? []).map((q) => (
              <li key={q.id} className="flex items-center justify-between gap-2">
                <span>
                  {q.quotationNumber} · {q.totalAmount}
                </span>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void onSend(withCaption({ type: 'QUOTATION', id: q.id }))}
                >
                  {t('send', { name: q.quotationNumber })}
                </Button>
              </li>
            ))}
            {quotations.data && quotations.data.length === 0 ? (
              <li className="text-sm text-neutral-600">{t('none')}</li>
            ) : null}
          </ul>
        ) : null}

        {tab === 'invoice' && c.customerId ? (
          <div className="flex flex-col gap-2">
            <ul aria-label={t('orders')} className="flex flex-wrap gap-2">
              {(orders.data ?? []).map((o) => (
                <li key={o.id}>
                  <Button
                    size="sm"
                    variant={orderId === o.id ? 'default' : 'outline'}
                    onClick={() => setOrderId(o.id)}
                  >
                    {o.orderNumber}
                  </Button>
                </li>
              ))}
            </ul>
            {orders.data && orders.data.length === 0 ? (
              <p className="text-sm text-neutral-600">{t('none')}</p>
            ) : null}
            {orderId ? (
              <ul
                aria-label={t('invoices', {
                  number: orders.data?.find((o) => o.id === orderId)?.orderNumber ?? '',
                })}
                className="flex flex-col gap-2"
              >
                {(invoices.data ?? []).map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2">
                    <span>{i.invoiceNumber}</span>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void onSend(withCaption({ type: 'INVOICE', id: i.id }))}
                    >
                      {t('send', { name: i.invoiceNumber })}
                    </Button>
                  </li>
                ))}
                {invoices.data && invoices.data.length === 0 ? (
                  <li className="text-sm text-neutral-600">{t('none')}</li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : null}

        {tab === 'file' ? (
          <div className="flex flex-col gap-2">
            <FileUpload onUploaded={setFile} />
            {file ? (
              <>
                <p className="text-sm">{t('uploaded', { name: file.name })}</p>
                <Button
                  disabled={busy}
                  onClick={() => void onSend(withCaption({ type: 'FILE', id: file.id }))}
                >
                  {t('sendFile')}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          {t('caption')}
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
