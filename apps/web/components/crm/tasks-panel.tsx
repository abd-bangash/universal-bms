'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { FormShell } from '@/components/forms/form-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import type { TaskView } from '@/lib/hooks/use-crm';
import { usePermission, useWorkspaceLocale } from '@/lib/session';

export const TASK_TYPES = ['CALL', 'FOLLOW_UP', 'MEETING', 'REMINDER', 'TODO'] as const;

interface TaskForm {
  type: (typeof TASK_TYPES)[number];
  title: string;
  dueAt: string;
}

/** A `datetime-local` value (no zone) means the browser's local time. */
export const localToIso = (value: string): string | null =>
  value === '' ? null : new Date(value).toISOString();

/** Add-task dialog, also used from the "My tasks" page (entity optional there). */
export function TaskDialog({
  open,
  onClose,
  entity,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  entity?: { entityType: 'CUSTOMER' | 'LEAD'; entityId: string };
  onSaved: () => void;
}) {
  const t = useTranslations('tasks');
  const tc = useTranslations('crm.taskTypes');
  const form = useForm<TaskForm>({ defaultValues: { type: 'TODO', title: '', dueAt: '' } });
  const { errors } = form.formState;

  async function save(values: TaskForm) {
    await api.post('/tasks', {
      type: values.type,
      title: values.title.trim(),
      dueAt: localToIso(values.dueAt),
      ...(entity ?? {}),
    });
    form.reset();
    onSaved();
    onClose();
  }

  return (
    <Modal open={open} title={t('new')} onClose={onClose}>
      {open ? (
        <FormShell
          form={form}
          onSubmit={save}
          submitLabel={t('save')}
          actions={
            <Button type="button" variant="outline" onClick={onClose}>
              {t('cancel')}
            </Button>
          }
        >
          <Field id="task-title" label={t('taskTitle')} error={errors.title?.message} required>
            <Input
              {...describedBy('task-title', { error: errors.title?.message })}
              {...form.register('title', {
                validate: (v) => v.trim() !== '' || t('titleRequired'),
              })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="task-type" label={t('type')}>
              <Select id="task-type" {...form.register('type')}>
                {TASK_TYPES.map((v) => (
                  <option key={v} value={v}>
                    {tc(v)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="task-due" label={t('dueAt')} error={errors.dueAt?.message}>
              <Input
                {...describedBy('task-due', { error: errors.dueAt?.message })}
                type="datetime-local"
                {...form.register('dueAt')}
              />
            </Field>
          </div>
        </FormShell>
      ) : null}
    </Modal>
  );
}

/** The open tasks of one customer or lead, with add and complete. */
export function TasksPanel({
  entityType,
  entityId,
}: {
  entityType: 'CUSTOMER' | 'LEAD';
  entityId: string;
}) {
  const t = useTranslations('crm.tasksPanel');
  const tc = useTranslations('crm.taskTypes');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const canCreate = usePermission('task:create');
  const canEdit = usePermission('task:edit');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tasks = useQuery({
    queryKey: ['tasks', entityType, entityId],
    queryFn: ({ signal }) =>
      api.getPage<TaskView>('/tasks', { entityType, entityId, limit: 50 }, signal),
    select: (page) => page.items,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    await queryClient.invalidateQueries({ queryKey: ['timeline'] });
  };

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
    <section aria-labelledby={`tasks-${entityId}`} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`tasks-${entityId}`} className="font-medium">
          {t('title')}
        </h2>
        {canCreate ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            {t('add')}
          </Button>
        ) : null}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {tasks.isSuccess && tasks.data.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('empty')}</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {(tasks.data ?? []).map((task) => {
          const overdue = task.dueAt !== null && new Date(task.dueAt).getTime() < Date.now();
          return (
            <li
              key={task.id}
              className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 p-3 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{task.title}</p>
                <p className={overdue ? 'text-xs text-red-700' : 'text-xs text-neutral-600'}>
                  {tc(task.type)} ·{' '}
                  {task.dueAt
                    ? `${overdue ? `${t('overdue')}: ` : ''}${t('dueOn', { date: formatDateTime(task.dueAt, locale) })}`
                    : t('noDate')}
                </p>
              </div>
              {canEdit ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void complete(task)}
                >
                  {t('complete')}
                  <span className="sr-only"> {task.title}</span>
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <TaskDialog
        open={adding}
        onClose={() => setAdding(false)}
        entity={{ entityType, entityId }}
        onSaved={() => void refresh()}
      />
    </section>
  );
}
