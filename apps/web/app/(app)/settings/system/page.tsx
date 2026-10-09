'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { SystemStatusView } from './system-status';

export default function SystemPage() {
  return (
    <PageGuard permission="system:view">
      <SystemStatusView />
    </PageGuard>
  );
}
