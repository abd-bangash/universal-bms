'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { FormShell } from '@/components/forms/form-shell';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { useLostReasonsQuery } from '@/lib/hooks/use-crm';

interface LostForm {
  lostReasonId: string;
  note: string;
}

/** Asks why a lead was lost before moving it (Requirement 9.5). */
export function LostDialog({
  leadId,
  stage,
  onClose,
  onMoved,
}: {
  leadId: string | null;
  stage: string;
  onClose: () => void;
  onMoved: () => void;
}) {
  const t = useTranslations('leads.lost');
  const reasons = useLostReasonsQuery();
  const form = useForm<LostForm>({ defaultValues: { lostReasonId: '', note: '' } });
  const { errors } = form.formState;

  async function submit(values: LostForm) {
    await api.post(`/leads/${leadId}/stage`, {
      stage,
      lostReasonId: values.lostReasonId,
      note: values.note.trim() || undefined,
    });
    form.reset();
    onMoved();
  }

  return (
    <Modal open={leadId !== null} title={t('title')} onClose={onClose}>
      {leadId ? (
        <FormShell
          form={form}
          onSubmit={submit}
          submitLabel={t('confirm')}
          actions={
            <Button type="button" variant="outline" onClick={onClose}>
              {t('cancel')}
            </Button>
          }
        >
          <Field id="lost-reason" label={t('reason')} error={errors.lostReasonId?.message} required>
            <Select
              id="lost-reason"
              aria-invalid={errors.lostReasonId ? true : undefined}
              {...form.register('lostReasonId', { validate: (v) => v !== '' || t('required') })}
            >
              <option value="">{t('choose')}</option>
              {(reasons.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="lost-note" label={t('note')}>
            <Input id="lost-note" {...form.register('note')} />
          </Field>
        </FormShell>
      ) : null}
    </Modal>
  );
}

/**
 * Moving a lead to another stage. Stages that need more information (Lost) open a dialog first;
 * everything else is a single request. Returns what the screen needs to render the dialog and errors.
 */
export function useLeadMove(options: { lostStage: (stage: string) => boolean }) {
  const t = useTranslations('leads');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<{ leadId: string; stage: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['pipeline'] });
    await queryClient.invalidateQueries({ queryKey: ['lead'] });
    await queryClient.invalidateQueries({ queryKey: ['list', 'leads'] });
    await queryClient.invalidateQueries({ queryKey: ['timeline'] });
  };

  async function move(leadId: string, stage: string) {
    setError(null);
    if (options.lostStage(stage)) {
      setAsking({ leadId, stage });
      return;
    }
    try {
      await api.post(`/leads/${leadId}/stage`, { stage });
      await refresh();
    } catch (e) {
      setError(message(e) || t('moveFailed'));
    }
  }

  const dialog = (
    <LostDialog
      leadId={asking?.leadId ?? null}
      stage={asking?.stage ?? ''}
      onClose={() => setAsking(null)}
      onMoved={() => {
        setAsking(null);
        void refresh();
      }}
    />
  );
  return { move, dialog, error, clearError: () => setError(null) };
}
