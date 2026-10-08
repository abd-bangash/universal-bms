'use client';

import { useParams } from 'next/navigation';
import { PageGuard } from '@/components/layout/page-guard';
import { PurchaseDetail } from '../../purchase-detail';

export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PageGuard permission="purchase:view">
      <PurchaseDetail purchaseId={id} />
    </PageGuard>
  );
}
