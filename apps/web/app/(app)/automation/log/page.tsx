'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { AiLog } from './ai-log';

export default function AiLogPage() {
  return (
    <PageGuard permission="ai:view_logs">
      <AiLog />
    </PageGuard>
  );
}
