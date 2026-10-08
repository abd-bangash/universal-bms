'use client';

import { useParams } from 'next/navigation';
import { PageGuard } from '@/components/layout/page-guard';
import { LeadDetail } from '../lead-detail';

export default function LeadPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PageGuard permission="lead:view">
      <LeadDetail leadId={id} />
    </PageGuard>
  );
}
