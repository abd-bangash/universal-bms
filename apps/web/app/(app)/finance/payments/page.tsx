'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { PaymentList } from './payment-list';

export default function PaymentsPage() {
  return (
    <PageGuard permission="payment:view">
      <PaymentList />
    </PageGuard>
  );
}
