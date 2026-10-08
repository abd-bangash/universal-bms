'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { ME_QUERY_KEY, usePermission } from '@/lib/session';
import { SETTINGS_QUERY_KEY } from '@/lib/hooks/use-settings';

interface ProfileRow {
  key: string;
  name: string;
  isCurrent: boolean;
}
interface ApplyResult {
  fieldDefinitions: number;
  states: number;
  units: number;
}

export function ProfilePanel() {
  const t = useTranslations('settings.industry');
  const message = useErrorMessage();
  const canConfigure = usePermission('workspace:configure');
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<ProfileRow | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  const profiles = useQuery({
    queryKey: ['industry-profiles'],
    queryFn: () => api.get<ProfileRow[]>('/settings/industry-profiles'),
  });
  const apply = useMutation({
    mutationFn: (key: string) => api.post<ApplyResult>(`/settings/apply-profile/${key}`),
    onSuccess: async (data) => {
      setResult(data);
      setConfirming(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['industry-profiles'] }),
        queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['units'] }),
      ]);
    },
  });

  const current = profiles.data?.find((p) => p.isCurrent);

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('profile')}</h2>
      {profiles.isError ? <Alert>{message(profiles.error)}</Alert> : null}
      {current ? <p className="text-sm">{t('currentProfile', { name: current.name })}</p> : null}
      <ul className="flex flex-col gap-2">
        {profiles.data?.map((p) => (
          <li
            key={p.key}
            className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 px-3 py-2"
          >
            <span>
              {p.name}{' '}
              {p.isCurrent ? (
                <span className="ml-2 rounded bg-neutral-900 px-2 py-0.5 text-xs text-white">
                  {t('current')}
                </span>
              ) : null}
            </span>
            {canConfigure ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(p)}>
                {t('apply')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {result ? (
        <Alert tone="success">
          {t('applied', {
            fields: result.fieldDefinitions,
            states: result.states,
            units: result.units,
          })}
        </Alert>
      ) : null}
      {apply.isError ? <Alert>{message(apply.error)}</Alert> : null}
      <ConfirmDialog
        open={confirming !== null}
        title={t('applyTitle', { name: confirming?.name ?? '' })}
        description={t('applyDescription')}
        confirmLabel={t('apply')}
        pending={apply.isPending}
        onConfirm={() => confirming && apply.mutate(confirming.key)}
        onCancel={() => setConfirming(null)}
      />
    </Card>
  );
}
