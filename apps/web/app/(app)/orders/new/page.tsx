'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { OrderForm } from '../order-form';

export default function NewOrderPage() {
  return (
    <PageGuard permission="order:create">
      <OrderForm order={null} />
    </PageGuard>
  );
}
