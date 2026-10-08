'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePermission } from '@/lib/session';
import { cn } from '@/lib/utils';

export function FinanceNav() {
  const t = useTranslations('finance.nav');
  const pathname = usePathname();
  const canPayments = usePermission('payment:view');
  const canExpenses = usePermission('expense:view');
  const canAccounts = usePermission('account:view');
  const tabs = [
    { href: '/finance/payments', label: t('payments'), show: canPayments },
    { href: '/finance/expenses', label: t('expenses'), show: canExpenses },
    { href: '/finance/receivables', label: t('receivables'), show: canPayments },
    { href: '/finance/accounts', label: t('accounts'), show: canAccounts },
  ].filter((tab) => tab.show);
  return (
    <nav aria-label={t('label')} className="mb-4 flex flex-wrap gap-1 border-b border-neutral-200">
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-t-md px-3 py-2 text-sm',
              active
                ? 'border-b-2 border-neutral-900 font-medium'
                : 'text-neutral-600 hover:text-neutral-900',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
