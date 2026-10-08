'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { TaskDialog, TASK_TYPES } from '@/components/crm/tasks-panel';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import type { TaskView } from '@/lib/hooks/use-crm';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { cn } from '@/lib/utils';

const BUCKETS = ['overdue', 'today', 'upcoming', 'none'] as const;
type Bucket = (typeof BUCKETS)[number];

/** "My tasks": what is overdue, due later today, coming up, and undated (Requirement 30.3). */
export function MyTasks() {
  const t = useTranslations('tasks');
  const tc = useTranslations('crm.taskTypes');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const canCreate = usePermission('task:create');
  const canEdit = usePermission('task:edit');
  const canSeeAll = usePermission('task:view_all');
  const [bucket, setBucket] = useState<Bucket>('overdue');
  const [type, setType] = useState('');
  const [mine, setMine] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counts = useQuery({
    queryKey: ['tasks', 'counts', mine, type],
    queryFn: async ({ signal }) => {
      const entries = await Promise.all(
        BUCKETS.map(async (b) => {
          const page = await api.getPage<TaskView>(
            '/tasks',
            { due: b, mine, type: type || undefined, limit: 100 },
            signal,
          );
          return [b, page.items.length] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<Bucket, number>;
    },
  });
  const tasks = useQuery({
    queryKey: ['tasks', 'bucket', bucket, mine, type],
    queryFn: ({ signal }) =>
      api.getPage<TaskView>(
        '/tasks',
        { due: bucket, mine, type: type || undefined, limit: 100 },
        signal,
      ),
    select: (page) => page.items,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tasks'] });
  async function complete(task: TaskView) {
    setError(null);
    try {
      await api.post(`/tasks/${task.id}/complete`);
      await refresh();
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {canCreate ? (
          <Button type="button" onClick={() => setAdding(true)}>
            {t('new')}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="task-type-filter">{t('type')}</Label>
          <Select id="task-type-filter" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{t('allTypes')}</option>
            {TASK_TYPES.map((v) => (
              <option key={v} value={v}>
                {tc(v)}
              </option>
            ))}
          </Select>
        </div>
        {canSeeAll ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            {t('mine')}
          </label>
        ) : null}
      </div>

      <div
        role="tablist"
        aria-label={t('title')}
        className="flex flex-wrap gap-1 border-b border-neutral-200"
      >
        {BUCKETS.map((b) => (
          <button
            key={b}
            type="button"
            role="tab"
            aria-selected={bucket === b}
            onClick={() => setBucket(b)}
            className={cn(
              'rounded-t-md px-3 py-2 text-sm',
              bucket === b
                ? 'border-b-2 border-neutral-900 font-medium'
                : 'text-neutral-600 hover:text-neutral-900',
            )}
          >
            {t(`buckets.${b}`)}
            {counts.data ? (
              <span className="ml-1 text-xs text-neutral-600">({counts.data[b]})</span>
            ) : null}
          </button>
        ))}
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {tasks.isError ? <Alert>{message(tasks.error)}</Alert> : null}
      {tasks.isSuccess && tasks.data.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('empty')}</p>
      ) : null}
      <ul role="tabpanel" className="flex flex-col gap-2">
        {(tasks.data ?? []).map((task) => (
          <li
            key={task.id}
            className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-white p-3 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{task.title}</p>
              <p
                className={cn(
                  'text-xs',
                  bucket === 'overdue' ? 'text-red-700' : 'text-neutral-600',
                )}
              >
                {tc(task.type)}
                {task.dueAt ? ` · ${formatDateTime(task.dueAt, locale)}` : ''}
              </p>
              {task.entityType && task.entityId ? (
                <Link
                  href={`/${task.entityType === 'CUSTOMER' ? 'customers' : 'leads'}/${task.entityId}`}
                  className="text-xs underline"
                >
                  {task.entityType === 'CUSTOMER' ? t('linkedCustomer') : t('linkedLead')}
                </Link>
              ) : null}
            </div>
            {canEdit ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void complete(task)}>
                {t('complete')}
                <span className="sr-only"> {task.title}</span>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <TaskDialog open={adding} onClose={() => setAdding(false)} onSaved={() => void refresh()} />
    </div>
  );
}
