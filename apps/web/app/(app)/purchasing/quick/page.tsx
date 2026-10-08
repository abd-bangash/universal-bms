'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { PurchaseForm } from '../purchase-form';

export default function QuickPurchasePage() {
  return (
    <PageGuard permission="purchase:create">
      <PurchaseForm mode="quick" />
    </PageGuard>
  );
}
