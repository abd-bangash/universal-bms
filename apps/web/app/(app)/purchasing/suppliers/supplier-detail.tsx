'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatDate, formatMoney } from '@/lib/format';
import { useSupplier, type PurchaseHistoryRow } from '@/lib/hooks/use-purchasing';
import { useWorkflowStates } from '@/lib/hooks/use-sales';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { SupplierDialog } from './supplier-dialog';

/** One supplier: details, what is owed to them, and their purchase history (Requirements 7.8, 22.5). */
export function SupplierDetail({ supplierId }: { supplierId: string }) {
  const t = useTranslations('purchasing.supplier');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const canEdit = usePermission('supplier:edit');
  const canArchive = usePermission('supplier:archive');
  const canViewPurchases = usePermission('purchase:view');
  const states = useWorkflowStates('PURCHASE_ORDER').data ?? [];
  const supplier = useSupplier(supplierId);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ['supplier', supplierId, 'purchases'],
    enabled: canViewPurchases,
    queryFn: ({ signal }) =>
      api.get<PurchaseHistoryRow[]>(`/suppliers/${supplierId}/purchases`, undefined, signal),
  });

  if (supplier.isPending) return <p role="status">…</p>;
  if (supplier.isError) return <Alert>{message(supplier.error)}</Alert>;
  const s = supplier.data;
  const archived = s.status === 'ARCHIVED';

  async function toggleArchive() {
    setError(null);
    try {
      await api.post(`/suppliers/${supplierId}/${archived ? 'restore' : 'archive'}`);
      await queryClient.invalidateQueries({ queryKey: ['supplier'] });
      await queryClient.invalidateQueries({ queryKey: ['list', 'suppliers'] });
    } catch (e) {
      setError(message(e));
    }
  }

  const summary = s.summary;
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <Link href="/purchasing/suppliers" className="text-sm underline">
          {t('back')}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{s.name}</h1>
          <StatusBadge
            label={t(`statusLabels.${s.status}`)}
            color={archived ? '#78350f' : '#16a34a'}
          />
        </div>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex gap-2">
        {canEdit && !archived ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            {t('edit')}
          </Button>
        ) : null}
        {canArchive ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void toggleArchive()}>
            {archived ? t('restore') : t('archive')}
          </Button>
        ) : null}
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {(
          [
            ['contactName', s.contactName],
            ['phone', s.phone],
            ['email', s.email],
            ['address', s.address],
            ['notes', s.notes],
          ] as const
        )
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-neutral-600">{t(k)}</dt>
              <dd className="whitespace-pre-line">{v}</dd>
            </div>
          ))}
      </dl>

      {summary ? (
        <section aria-labelledby="payables-heading">
          <h2 id="payables-heading" className="font-medium">
            {t('payables')}
          </h2>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-4">
            {(
              [
                ['totalOrdered', summary.totalOrdered],
                ['totalReceived', summary.totalReceived],
                ['totalPaid', summary.totalPaid],
                ['balance', summary.balance],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-neutral-600">{t(k)}</dt>
                <dd className="tabular-nums">{formatMoney(v, locale)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {canViewPurchases ? (
        <section aria-labelledby="history-heading">
          <h2 id="history-heading" className="font-medium">
            {t('history')}
          </h2>
          {(history.data ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-neutral-600">{t('noPurchases')}</p>
          ) : (
            <ul className="mt-2 divide-y rounded border border-neutral-200 text-sm">
              {(history.data ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <Link href={`/purchasing/orders/${p.id}`} className="font-medium underline">
                    {p.orderNumber}
                  </Link>
                  <span>{states.find((x) => x.key === p.status)?.label ?? p.status}</span>
                  <span className="text-neutral-600">{formatDate(p.orderDate, locale)}</span>
                  <span className="tabular-nums">{formatMoney(p.totalAmount, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {editing ? <SupplierDialog open onClose={() => setEditing(false)} supplier={s} /> : null}
    </div>
  );
}
