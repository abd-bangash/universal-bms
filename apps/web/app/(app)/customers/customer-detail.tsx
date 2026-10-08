'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { NotesPanel } from '@/components/crm/notes-panel';
import { TasksPanel } from '@/components/crm/tasks-panel';
import { TimelinePanel } from '@/components/crm/timeline-panel';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatMoney } from '@/lib/format';
import type { CustomerView, LeadView } from '@/lib/hooks/use-crm';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { useTerminology } from '@/lib/terminology';
import { CustomerForm } from './customer-form';

interface Finance {
  lifetimeValue: string;
  totalPaid: string;
  outstandingBalance: string;
  creditBalance: string;
}

/** One customer: details, money, leads, tasks, notes and the full timeline (Requirements 8.1, 8.4, 8.6). */
export function CustomerDetail({ customerId }: { customerId: string }) {
  const t = useTranslations('customers.detail');
  const term = useTerminology();
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const canEdit = usePermission('customer:edit');
  const canArchive = usePermission('customer:archive');
  const canSeeMoney = usePermission('payment:view');
  const canSeeLeads = usePermission('lead:view');
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const customer = useQuery({
    queryKey: ['customer', customerId],
    queryFn: ({ signal }) => api.get<CustomerView>(`/customers/${customerId}`, undefined, signal),
  });
  const finance = useQuery({
    queryKey: ['customer', customerId, 'finance'],
    queryFn: ({ signal }) =>
      api.get<Finance>(`/customers/${customerId}/finance`, undefined, signal),
    enabled: canSeeMoney,
  });
  const leads = useQuery({
    queryKey: ['customer', customerId, 'leads'],
    queryFn: ({ signal }) => api.getPage<LeadView>('/leads', { customerId, limit: 20 }, signal),
    enabled: canSeeLeads,
    select: (page) => page.items,
  });

  if (customer.isPending) return <p role="status">{t('details')}…</p>;
  if (customer.isError) return <Alert>{message(customer.error)}</Alert>;
  const c = customer.data;
  const archived = c.status === 'ARCHIVED';

  async function setStatus(action: 'archive' | 'restore') {
    setActionError(null);
    try {
      await api.post(`/customers/${customerId}/${action}`);
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: ['customer'] });
      await queryClient.invalidateQueries({ queryKey: ['list', 'customers'] });
    } catch (e) {
      setActionError(message(e));
      setConfirming(false);
    }
  }

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <Link href="/customers" className="text-sm underline">
          {t('back')}
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">{c.fullName}</h1>
          {canArchive ? (
            archived ? (
              <Button type="button" variant="outline" onClick={() => void setStatus('restore')}>
                {t('restore')}
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
                {t('archive')}
              </Button>
            )
          ) : null}
        </div>
      </div>
      {archived ? <Alert tone="info">{t('archivedNotice')}</Alert> : null}
      {actionError ? <Alert>{actionError}</Alert> : null}

      {canSeeMoney && finance.data ? (
        <section aria-labelledby="customer-finance" className="flex flex-col gap-2">
          <h2 id="customer-finance" className="font-medium">
            {t('finance')}
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ['lifetimeValue', finance.data.lifetimeValue],
                ['totalPaid', finance.data.totalPaid],
                ['outstanding', finance.data.outstandingBalance],
                ['credit', finance.data.creditBalance],
              ] as const
            ).map(([key, value]) => (
              <Card key={key} className="p-4">
                <dt className="text-xs text-neutral-600">{t(key)}</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatMoney(value, locale)}</dd>
              </Card>
            ))}
          </dl>
        </section>
      ) : null}

      <section aria-labelledby="customer-details" className="flex flex-col gap-3">
        <h2 id="customer-details" className="sr-only">
          {t('details')}
        </h2>
        <CustomerForm key={`${c.id}-${c.version}`} customer={archived ? { ...c } : c} />
      </section>

      {canSeeLeads ? (
        <section aria-labelledby="customer-leads" className="flex flex-col gap-2">
          <h2 id="customer-leads" className="font-medium">
            {term('lead', 'plural')}
          </h2>
          {leads.isSuccess && leads.data.length === 0 ? (
            <p className="text-sm text-neutral-600">{t('noLeads')}</p>
          ) : null}
          <ul className="flex flex-col gap-1">
            {(leads.data ?? []).map((lead) => (
              <li key={lead.id}>
                <Link href={`/leads/${lead.id}`} className="underline">
                  {lead.fullName}
                </Link>{' '}
                <span className="text-sm text-neutral-600">({lead.stage})</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <TasksPanel entityType="CUSTOMER" entityId={customerId} />
        <NotesPanel entityType="CUSTOMER" entityId={customerId} canWrite={canEdit} />
      </div>
      <TimelinePanel path={`/customers/${customerId}/timeline`} queryKey={[customerId]} />

      <ConfirmDialog
        open={confirming}
        destructive
        title={t('archiveTitle', { name: c.fullName })}
        description={t('archiveDescription')}
        confirmLabel={t('archive')}
        onConfirm={() => void setStatus('archive')}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
