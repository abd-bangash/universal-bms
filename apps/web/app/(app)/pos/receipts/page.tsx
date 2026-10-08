'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { ReceiptHistory } from './receipt-history';

export default function PosReceiptsPage() {
  return (
    <PageGuard permission="pos:sell">
      <ReceiptHistory />
    </PageGuard>
  );
}
