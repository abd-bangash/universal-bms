'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { LeadsHome } from './leads-home';

export default function LeadsPage() {
  return (
    <PageGuard permission="lead:view">
      <LeadsHome />
    </PageGuard>
  );
}
