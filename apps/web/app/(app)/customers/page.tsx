'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { CustomerList } from './customer-list';

export default function CustomersPage() {
  return (
    <PageGuard permission="customer:view">
      <CustomerList />
    </PageGuard>
  );
}
