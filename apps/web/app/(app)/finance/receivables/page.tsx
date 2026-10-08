'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { ReceivablesPage } from './receivables-view';

export default function Page() {
  return (
    <PageGuard permission="payment:view">
      <ReceivablesPage />
    </PageGuard>
  );
}
