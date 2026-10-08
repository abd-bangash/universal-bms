'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DataTable, type Column, type FilterDefinition } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import type { LeadView, PipelineColumn } from '@/lib/hooks/use-crm';
import { useWorkspaceLocale } from '@/lib/session';

/** The same leads as the board, as a sortable, filterable table. */
export function LeadList() {
  const t = useTranslations('leads');
  const tp = useTranslations('crm.priority');
  const locale = useWorkspaceLocale();
  const board = useQuery({
    queryKey: ['pipeline'],
    queryFn: ({ signal }) => api.get<PipelineColumn[]>('/leads/pipeline', undefined, signal),
  });
  const stages = board.data ?? [];
  const stageOf = (key: string) => stages.find((s) => s.stage === key);

  const columns: Array<Column<LeadView>> = [
    {
      key: 'name',
      header: t('name'),
      sortKey: 'fullName',
      cell: (l) => (
        <Link href={`/leads/${l.id}`} className="font-medium underline-offset-2 hover:underline">
          {l.fullName}
        </Link>
      ),
    },
    { key: 'interest', header: t('interest'), cell: (l) => l.interest ?? '' },
    {
      key: 'value',
      header: t('value'),
      className: 'text-right',
      cell: (l) => <span className="tabular-nums">{formatMoney(l.estimatedValue, locale)}</span>,
    },
    { key: 'priority', header: t('priority'), cell: (l) => tp(l.priority) },
    {
      key: 'stage',
      header: t('stage'),
      cell: (l) => (
        <StatusBadge label={stageOf(l.stage)?.label ?? l.stage} color={stageOf(l.stage)?.color} />
      ),
    },
    {
      key: 'created',
      header: t('created'),
      sortKey: 'createdAt',
      cell: (l) => l.createdAt.slice(0, 10),
    },
  ];
  const filters: FilterDefinition[] = [
    {
      key: 'stage',
      label: t('filterStage'),
      options: stages.map((s) => ({ value: s.stage, label: s.label })),
    },
    {
      key: 'priority',
      label: t('filterPriority'),
      options: (['LOW', 'MEDIUM', 'HIGH'] as const).map((p) => ({ value: p, label: tp(p) })),
    },
  ];

  return (
    <DataTable<LeadView>
      queryKey="leads"
      endpoint="/leads"
      caption={t('caption')}
      columns={columns}
      rowKey={(l) => l.id}
      filters={filters}
      defaultSort="createdAt:desc"
      emptyTitle={t('empty')}
      emptyDescription={t('emptyDescription')}
    />
  );
}
