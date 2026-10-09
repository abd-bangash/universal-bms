'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { AiSettings } from './ai-settings';

export default function AiPage() {
  return (
    <PageGuard permission="ai:use">
      <AiSettings />
    </PageGuard>
  );
}
