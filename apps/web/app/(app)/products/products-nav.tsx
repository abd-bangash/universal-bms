'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTerminology } from '@/lib/terminology';
import { cn } from '@/lib/utils';

export function ProductsNav() {
  const t = useTranslations('products');
  const term = useTerminology();
  const pathname = usePathname();
  const tabs = [
    { href: '/products', label: term('product', 'plural'), active: pathname === '/products' },
    {
      href: '/products/categories',
      label: t('categories'),
      active: pathname.startsWith('/products/categories'),
    },
    {
      href: '/products/brands',
      label: t('brands'),
      active: pathname.startsWith('/products/brands'),
    },
  ];
  return (
    <nav aria-label={t('nav')} className="mb-4 flex flex-wrap gap-1 border-b border-neutral-200">
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
