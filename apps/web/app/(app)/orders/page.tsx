'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { OrderList } from './order-list';

export default function OrdersPage() {
  return (
    <PageGuard permission="order:view">
      <OrderList />
    </PageGuard>
  );
}
