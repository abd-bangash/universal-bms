'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { CommissionStatement } from './commission-statement';

export default function CommissionsPage() {
  return (
    <PageGuard permission="commission:view">
      <CommissionStatement />
    </PageGuard>
  );
}
