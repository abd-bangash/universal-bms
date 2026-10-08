'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { FormShell } from '@/components/forms/form-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import type { NoteView } from '@/lib/hooks/use-crm';
import { useWorkspaceLocale } from '@/lib/session';

interface NoteForm {
  body: string;
  callDirection: 'OUTBOUND' | 'INBOUND';
  callOutcome: string;
}

const OUTCOMES = ['ANSWERED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'WRONG_NUMBER'] as const;

/** Internal notes and call logs on a record; never visible to the customer (Requirement 30.2). */
export function NotesPanel({
  entityType,
  entityId,
  canWrite,
  onAdded,
}: {
  entityType: 'CUSTOMER' | 'LEAD' | 'ORDER' | 'QUOTATION';
  entityId: string;
  canWrite: boolean;
  onAdded?: () => void;
}) {
  const t = useTranslations('crm.notes');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'closed' | 'NOTE' | 'CALL'>('closed');
  const notes = useQuery({
    queryKey: ['notes', entityType, entityId],
    queryFn: ({ signal }) => api.get<NoteView[]>('/notes', { entityType, entityId }, signal),
  });
  const form = useForm<NoteForm>({
    defaultValues: { body: '', callDirection: 'OUTBOUND', callOutcome: 'ANSWERED' },
  });
  const { errors } = form.formState;

  async function save(values: NoteForm) {
    await api.post('/notes', {
      entityType,
      entityId,
      body: values.body.trim(),
      kind: mode,
      ...(mode === 'CALL'
        ? { callDirection: values.callDirection, callOutcome: values.callOutcome }
        : {}),
    });
    form.reset();
    setMode('closed');
    await queryClient.invalidateQueries({ queryKey: ['notes', entityType, entityId] });
    await queryClient.invalidateQueries({ queryKey: ['timeline'] });
    onAdded?.();
  }

  return (
    <section aria-labelledby={`notes-${entityId}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`notes-${entityId}`} className="font-medium">
          {t('title')}
        </h2>
        {canWrite && mode === 'closed' ? (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setMode('NOTE')}>
              {t('add')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setMode('CALL')}>
              {t('addCall')}
            </Button>
          </div>
        ) : null}
      </div>

      {mode !== 'closed' ? (
        <FormShell
          form={form}
          onSubmit={save}
          submitLabel={t('save')}
          actions={
            <Button type="button" variant="outline" onClick={() => setMode('closed')}>
              {t('cancel')}
            </Button>
          }
        >
          {mode === 'CALL' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="note-direction" label={t('callDirection')}>
                <Select id="note-direction" {...form.register('callDirection')}>
                  <option value="OUTBOUND">{t('outbound')}</option>
                  <option value="INBOUND">{t('inbound')}</option>
                </Select>
              </Field>
              <Field id="note-outcome" label={t('callOutcome')}>
                <Select id="note-outcome" {...form.register('callOutcome')}>
                  {OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {t(`outcomes.${o}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : null}
          <Field id="note-body" label={t('body')} error={errors.body?.message}>
            <Textarea
              {...describedBy('note-body', { error: errors.body?.message })}
              {...form.register('body', { validate: (v) => v.trim() !== '' || t('bodyRequired') })}
            />
          </Field>
        </FormShell>
      ) : null}

      {notes.isError ? <Alert>{message(notes.error)}</Alert> : null}
      {notes.isSuccess && notes.data.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('empty')}</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {(notes.data ?? []).map((note) => (
          <li key={note.id} className="rounded-md border border-neutral-200 p-3 text-sm">
            {note.kind === 'CALL' ? (
              <p className="mb-1 font-medium">
                {t('callLine', {
                  direction: note.callDirection === 'INBOUND' ? t('incoming') : t('outgoing'),
                  outcome: t(`outcomes.${note.callOutcome ?? 'ANSWERED'}`).toLowerCase(),
                })}
              </p>
            ) : null}
            <p className="whitespace-pre-wrap">{note.body}</p>
            <p className="mt-1 text-xs text-neutral-600">
              {t('by', {
                name: note.createdByName ?? '—',
                date: formatDateTime(note.createdAt, locale),
              })}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
