'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePermission } from '@/lib/session';
import { useTerminology } from '@/lib/terminology';
import { cn } from '@/lib/utils';

export function PurchasingNav() {
  const t = useTranslations('purchasing.nav');
  const term = useTerminology();
  const pathname = usePathname();
  const canBuy = usePermission('purchase:create');
  const tabs = [
    {
      href: '/purchasing/orders',
      label: term('purchaseOrder', 'plural'),
      active: pathname.startsWith('/purchasing/orders'),
      show: true,
    },
    {
      href: '/purchasing/suppliers',
      label: term('supplier', 'plural'),
      active: pathname.startsWith('/purchasing/suppliers'),
      show: true,
    },
    {
      href: '/purchasing/quick',
      label: t('quick'),
      active: pathname.startsWith('/purchasing/quick'),
      show: canBuy,
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
