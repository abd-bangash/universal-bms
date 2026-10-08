'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { QuotationForm } from '../quotation-form';

export default function NewQuotationPage() {
  return (
    <PageGuard permission="quotation:create">
      <QuotationForm quotation={null} />
    </PageGuard>
  );
}
