'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePermission } from '@/lib/session';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'business', href: '/settings/business', permission: 'workspace:view' },
  { key: 'industry', href: '/settings/industry', permission: 'workspace:view' },
  { key: 'audit', href: '/settings/audit', permission: 'audit:view' },
] as const;

export function SettingsNav() {
  const t = useTranslations('settings');
  const pathname = usePathname();
  return (
    <nav aria-label={t('nav')} className="mb-4 flex flex-wrap gap-1 border-b border-neutral-200">
      {TABS.map((tab) => (
        <Tab
          key={tab.key}
          href={tab.href}
          permission={tab.permission}
          active={pathname.startsWith(tab.href)}
        >
          {t(`tabs.${tab.key}`)}
        </Tab>
      ))}
    </nav>
  );
}

function Tab({
  href,
  permission,
  active,
  children,
}: {
  href: string;
  permission: string;
  active: boolean;
  children: React.ReactNode;
}) {
  const allowed = usePermission(permission);
  if (!allowed) return null;
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        '-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm',
        active
          ? 'border-neutral-900 font-medium'
          : 'border-transparent text-neutral-600 hover:text-neutral-900',
      )}
    >
      {children}
    </Link>
  );
}
