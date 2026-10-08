'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Select } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatMoney } from '@/lib/format';
import type { PipelineCard, PipelineColumn } from '@/lib/hooks/use-crm';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { cn } from '@/lib/utils';
import { useLeadMove } from './lead-move';

const PRIORITY_DOT = { LOW: 'bg-neutral-400', MEDIUM: 'bg-amber-500', HIGH: 'bg-red-600' } as const;

/**
 * The pipeline: one column per stage. A card can be dragged onto any stage the workflow allows, or
 * moved with the menu on the card (touch screens and keyboards). The API decides what is allowed.
 */
export function LeadBoard() {
  const t = useTranslations('leads');
  const tp = useTranslations('crm.priority');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const canEdit = usePermission('lead:edit');
  const [dragging, setDragging] = useState<{ id: string; stage: string } | null>(null);
  const board = useQuery({
    queryKey: ['pipeline'],
    queryFn: ({ signal }) => api.get<PipelineColumn[]>('/leads/pipeline', undefined, signal),
  });
  const columns = board.data ?? [];
  const { move, dialog, error } = useLeadMove({
    lostStage: (stage) => columns.find((c) => c.stage === stage)?.systemRole === 'LOST',
  });

  const accepts = (column: PipelineColumn) =>
    dragging !== null && column.acceptsFrom.includes(dragging.stage);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-neutral-600">{t('dragHint')}</p>
      {board.isError ? <Alert>{message(board.error)}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      {board.isPending ? <p role="status">…</p> : null}
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
        {columns.map((column) => (
          <section
            key={column.stage}
            aria-label={t('columnLabel', {
              label: column.label,
              count: column.count,
              value: formatMoney(column.value, locale),
            })}
            className={cn(
              'flex w-64 shrink-0 snap-start flex-col gap-2 rounded-lg border bg-neutral-100 p-2',
              accepts(column) ? 'border-neutral-900' : 'border-neutral-200',
            )}
            onDragOver={(event) => {
              if (accepts(column)) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging && accepts(column)) void move(dragging.id, column.stage);
              setDragging(null);
            }}
          >
            <header className="flex items-center justify-between gap-2 px-1">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: column.color }}
                />
                {column.label}
              </h3>
              <span className="text-xs text-neutral-600">
                {column.count} · {formatMoney(column.value, locale)}
              </span>
            </header>
            <ul className="flex flex-col gap-2">
              {column.cards.map((card) => (
                <Card
                  key={card.id}
                  card={card}
                  column={column}
                  columns={columns}
                  canEdit={canEdit}
                  priorityLabel={tp(card.priority)}
                  onDragStart={() => setDragging({ id: card.id, stage: column.stage })}
                  onDragEnd={() => setDragging(null)}
                  onMove={(stage) => void move(card.id, stage)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {dialog}
    </div>
  );
}

function Card({
  card,
  column,
  columns,
  canEdit,
  priorityLabel,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  card: PipelineCard;
  column: PipelineColumn;
  columns: PipelineColumn[];
  canEdit: boolean;
  priorityLabel: string;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (stage: string) => void;
}) {
  const t = useTranslations('leads');
  const locale = useWorkspaceLocale();
  const targets = columns.filter((c) => c.acceptsFrom.includes(column.stage));
  return (
    <li
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-white p-2 text-sm shadow-sm"
    >
      <Link href={`/leads/${card.id}`} className="font-medium underline-offset-2 hover:underline">
        {card.fullName}
      </Link>
      {card.interest ? (
        <p className="line-clamp-2 text-xs text-neutral-600">{card.interest}</p>
      ) : null}
      <p className="flex items-center gap-2 text-xs text-neutral-600">
        <span
          className={cn('h-2 w-2 rounded-full', PRIORITY_DOT[card.priority])}
          aria-hidden="true"
        />
        {priorityLabel}
        {card.estimatedValue ? (
          <span className="ml-auto tabular-nums">{formatMoney(card.estimatedValue, locale)}</span>
        ) : null}
      </p>
      {canEdit && targets.length > 0 ? (
        <>
          <label htmlFor={`move-${card.id}`} className="sr-only">
            {t('moveTo', { name: card.fullName })}
          </label>
          <Select
            id={`move-${card.id}`}
            value=""
            className="h-8 text-xs"
            onChange={(event) => event.target.value && onMove(event.target.value)}
          >
            <option value="">{t('moveSelect')}</option>
            {targets.map((c) => (
              <option key={c.stage} value={c.stage}>
                {c.label}
              </option>
            ))}
          </Select>
        </>
      ) : null}
    </li>
  );
}
