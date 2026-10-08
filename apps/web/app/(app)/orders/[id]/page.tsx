'use client';

import { useParams } from 'next/navigation';
import { PageGuard } from '@/components/layout/page-guard';
import { OrderDetail } from '../order-detail';

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PageGuard permission="order:view">
      <OrderDetail orderId={id} />
    </PageGuard>
  );
}
