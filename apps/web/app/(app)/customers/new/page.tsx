'use client';

import { useTranslations } from 'next-intl';
import { PageGuard } from '@/components/layout/page-guard';
import { useTerminology } from '@/lib/terminology';
import { CustomerForm } from '../customer-form';

export default function NewCustomerPage() {
  const t = useTranslations('customers');
  const term = useTerminology();
  return (
    <PageGuard permission="customer:create">
      <div className="flex max-w-3xl flex-col gap-4">
        <h1 className="text-2xl font-semibold">
          {t('new', { customer: term('customer').toLowerCase() })}
        </h1>
        <CustomerForm customer={null} />
      </div>
    </PageGuard>
  );
}
