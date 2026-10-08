'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { useLowStockCount } from '@/lib/hooks/use-inventory';
import { usePermission, useSession } from '@/lib/session';

export default function HomePage() {
  const t = useTranslations('home');
  const { user, workspace, roles } = useSession();
  const canSeeStock = usePermission('inventory:view');
  const lowStock = useLowStockCount(canSeeStock);
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <Card>
        <p className="text-lg font-medium">{t('welcome', { name: user.firstName })}</p>
        <p className="mt-1 text-neutral-700">{t('workspace', { workspace: workspace.name })}</p>
        <p className="text-neutral-700">{t('roles', { roles: roles.join(', ') })}</p>
        <p className="mt-4 text-sm text-neutral-600">{t('comingSoon')}</p>
      </Card>
      {canSeeStock && lowStock.data !== undefined ? (
        <Card>
          <p className="font-medium">{t('lowStockTitle')}</p>
          <p className="mt-1 text-neutral-700">
            <Link href="/inventory" className="underline">
              {t('lowStock', { count: lowStock.data })}
            </Link>
          </p>
        </Card>
      ) : null}
    </div>
  );
}
