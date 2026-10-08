'use client';

import { useParams } from 'next/navigation';
import { PageGuard } from '@/components/layout/page-guard';
import { CustomerDetail } from '../customer-detail';

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PageGuard permission="customer:view">
      <CustomerDetail customerId={id} />
    </PageGuard>
  );
}
