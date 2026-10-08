'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { FormShell } from '@/components/forms/form-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { LOST_REASONS_KEY, useLostReasonsQuery } from '@/lib/hooks/use-crm';
import { usePermission } from '@/lib/session';

/** The reasons offered when a lead is marked lost; reasons are deactivated, never deleted. */
export function LostReasonsPanel() {
  const t = useTranslations('settings.lostReasons');
  const message = useErrorMessage();
  const canConfigure = usePermission('workspace:configure');
  const queryClient = useQueryClient();
  const reasons = useLostReasonsQuery(true);
  const form = useForm<{ name: string }>({ defaultValues: { name: '' } });
  const { errors } = form.formState;

  const refresh = () => queryClient.invalidateQueries({ queryKey: LOST_REASONS_KEY });
  async function add({ name }: { name: string }) {
    await api.post('/settings/lost-reasons', { name: name.trim() });
    form.reset();
    await refresh();
  }
  async function toggle(id: string, active: boolean) {
    await api.patch(`/settings/lost-reasons/${id}`, { active });
    await refresh();
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('title')}</h2>
      <p className="text-sm text-neutral-600">{t('description')}</p>
      {reasons.isError ? <Alert>{message(reasons.error)}</Alert> : null}
      {reasons.isSuccess && reasons.data.length === 0 ? (
        <p className="text-sm">{t('empty')}</p>
      ) : null}
      <ul className="divide-y divide-neutral-200">
        {(reasons.data ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className={r.active ? '' : 'text-neutral-500'}>
              {r.name}
              {r.active ? null : (
                <StatusBadge className="ml-2" label={t('inactive')} color="#a3a3a3" />
              )}
            </span>
            {canConfigure ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void toggle(r.id, !r.active)}
              >
                {r.active ? t('deactivate') : t('activate')}
                <span className="sr-only"> {r.name}</span>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {canConfigure ? (
        <FormShell
          form={form}
          onSubmit={add}
          submitLabel={t('add')}
          className="flex flex-wrap items-end gap-2"
        >
          <Field id="lost-reason-name" label={t('name')} error={errors.name?.message}>
            <Input
              {...describedBy('lost-reason-name', { error: errors.name?.message })}
              {...form.register('name', { validate: (v) => v.trim() !== '' || t('nameRequired') })}
            />
          </Field>
        </FormShell>
      ) : null}
    </Card>
  );
}
