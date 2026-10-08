'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export function PosNav() {
  const t = useTranslations('pos.nav');
  const pathname = usePathname();
  const tabs = [
    { href: '/pos', label: t('sell'), active: pathname === '/pos' },
    { href: '/pos/receipts', label: t('receipts'), active: pathname.startsWith('/pos/receipts') },
  ];
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
