'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { LeadForm } from '../lead-form';

export default function NewLeadPage() {
  return (
    <PageGuard permission="lead:create">
      <LeadForm lead={null} />
    </PageGuard>
  );
}
