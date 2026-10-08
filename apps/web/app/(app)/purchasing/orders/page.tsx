'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { PurchaseList } from '../purchase-list';

export default function PurchaseOrdersPage() {
  return (
    <PageGuard permission="purchase:view">
      <PurchaseList />
    </PageGuard>
  );
}
