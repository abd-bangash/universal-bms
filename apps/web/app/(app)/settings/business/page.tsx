'use client';

import { useTranslations } from 'next-intl';
import { PageGuard } from '@/components/layout/page-guard';
import { Alert } from '@/components/ui/alert';
import { useSettingsQuery } from '@/lib/hooks/use-settings';
import { useErrorMessage } from '@/lib/error-message';
import { BusinessForm } from './business-form';

export default function BusinessSettingsPage() {
  const t = useTranslations('settings.business');
  const message = useErrorMessage();
  const settings = useSettingsQuery();
  return (
    <PageGuard permission="workspace:view">
      <h1 className="mb-4 text-2xl font-semibold">{t('title')}</h1>
      {settings.isPending ? (
        <p role="status">…</p>
      ) : settings.isError ? (
        <Alert>{message(settings.error)}</Alert>
      ) : (
        <BusinessForm snapshot={settings.data} />
      )}
    </PageGuard>
  );
}
