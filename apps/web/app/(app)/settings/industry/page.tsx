'use client';

import { useTranslations } from 'next-intl';
import { PageGuard } from '@/components/layout/page-guard';
import { LostReasonsPanel } from './lost-reasons-panel';
import { ModulesPanel } from './modules-panel';
import { ProfilePanel } from './profile-panel';
import { TaxPanel } from './tax-panel';
import { UnitsPanel } from './units-panel';

export default function IndustrySettingsPage() {
  const t = useTranslations('settings.industry');
  return (
    <PageGuard permission="workspace:view">
      <h1 className="mb-4 text-2xl font-semibold">{t('title')}</h1>
      <div className="flex flex-col gap-6">
        <ProfilePanel />
        <ModulesPanel />
        <UnitsPanel />
        <TaxPanel />
        <LostReasonsPanel />
      </div>
    </PageGuard>
  );
}
