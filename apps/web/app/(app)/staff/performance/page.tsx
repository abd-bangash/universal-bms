'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { PerformanceView } from './performance-view';

export default function PerformancePage() {
  return (
    <PageGuard permission="commission:view">
      <PerformanceView />
    </PageGuard>
  );
}
