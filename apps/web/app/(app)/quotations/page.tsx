'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { QuotationList } from './quotation-list';

export default function QuotationsPage() {
  return (
    <PageGuard permission="quotation:view">
      <QuotationList />
    </PageGuard>
  );
}
