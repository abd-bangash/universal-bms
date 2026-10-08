'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import {
  SETTINGS_QUERY_KEY,
  useSettingsQuery,
  type SettingsSnapshot,
} from '@/lib/hooks/use-settings';
import { ME_QUERY_KEY, usePermission } from '@/lib/session';

const MODULES = [
  'pos',
  'purchasing',
  'commissions',
  'messaging',
  'ai',
  'automation',
  'production',
  'priceLists',
  'multiLocation',
] as const;

/** Switches take effect for everyone on their next request (Requirement 5.3). */
export function ModulesPanel() {
  const t = useTranslations('settings.industry');
  const message = useErrorMessage();
  const canConfigure = usePermission('workspace:configure');
  const queryClient = useQueryClient();
  const settings = useSettingsQuery();

  const toggle = useMutation({
    mutationFn: ({ module, enabled }: { module: string; enabled: boolean }) =>
      api.patch<SettingsSnapshot>('/settings', { modules: { [module]: enabled } }),
    onSuccess: async (data) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, data);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('modules')}</h2>
      <p className="text-sm text-neutral-600">{t('modulesHint')}</p>
      {settings.isError ? <Alert>{message(settings.error)}</Alert> : null}
      {toggle.isError ? <Alert>{message(toggle.error)}</Alert> : null}
      <ul className="grid gap-2 sm:grid-cols-2">
        {MODULES.map((module) => (
          <li key={module}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.data?.config.modules[module] === true}
                disabled={!canConfigure || !settings.data || toggle.isPending}
                onChange={(event) => toggle.mutate({ module, enabled: event.target.checked })}
              />
              {t(`moduleLabels.${module}`)}
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}
