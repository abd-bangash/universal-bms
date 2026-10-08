'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { usePermission } from '@/lib/session';

/**
 * Shows a page only to users who hold the permission. This is a courtesy for people who type a
 * web address: the API refuses the data anyway.
 */
export function PageGuard({ permission, children }: { permission: string; children: ReactNode }) {
  const t = useTranslations('pageGuard');
  const allowed = usePermission(permission);
  if (!allowed) {
    return (
      <Alert tone="info">
        <p className="font-medium">{t('title')}</p>
        <p>{t('description')}</p>
      </Alert>
    );
  }
  return <>{children}</>;
}
