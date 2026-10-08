'use client';

import { useParams } from 'next/navigation';
import { PageGuard } from '@/components/layout/page-guard';
import { QuotationDetail } from '../quotation-detail';

export default function QuotationPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PageGuard permission="quotation:view">
      <QuotationDetail quotationId={id} />
    </PageGuard>
  );
}
