'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePermission } from '@/lib/session';
import { cn } from '@/lib/utils';

export function InventoryNav() {
  const t = useTranslations('inventory.nav');
  const pathname = usePathname();
  const canAdjust = usePermission('inventory:adjust');
  const tabs = [
    { href: '/inventory', label: t('stock'), active: pathname === '/inventory', show: true },
    {
      href: '/inventory/movements',
      label: t('movements'),
      active: pathname.startsWith('/inventory/movements'),
      show: true,
    },
    {
      href: '/inventory/adjust',
      label: t('adjust'),
      active: pathname.startsWith('/inventory/adjust'),
      show: canAdjust,
    },
    {
      href: '/inventory/locations',
      label: t('locations'),
      active: pathname.startsWith('/inventory/locations'),
      show: true,
    },
  ].filter((tab) => tab.show);
  return (
    <nav aria-label={t('label')} className="mb-4 flex flex-wrap gap-1 border-b border-neutral-200">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? 'page' : undefined}
          className={cn(
            'rounded-t-md px-3 py-2 text-sm',
            tab.active
              ? 'border-b-2 border-neutral-900 font-medium'
              : 'text-neutral-600 hover:text-neutral-900',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
