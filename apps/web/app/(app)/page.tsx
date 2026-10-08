'use client';

import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { useSession } from '@/lib/session';

export default function HomePage() {
  const t = useTranslations('home');
  const { user, workspace, roles } = useSession();
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <Card>
        <p className="text-lg font-medium">{t('welcome', { name: user.firstName })}</p>
        <p className="mt-1 text-neutral-700">{t('workspace', { workspace: workspace.name })}</p>
        <p className="text-neutral-700">{t('roles', { roles: roles.join(', ') })}</p>
        <p className="mt-4 text-sm text-neutral-600">{t('comingSoon')}</p>
      </Card>
    </div>
  );
}
