'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { PurchaseForm } from '../../purchase-form';

export default function NewPurchaseOrderPage() {
  return (
    <PageGuard permission="purchase:create">
      <PurchaseForm mode="create" />
    </PageGuard>
  );
}
