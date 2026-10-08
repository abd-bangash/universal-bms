'use client';

import { Suspense } from 'react';
import { PageGuard } from '@/components/layout/page-guard';
import { Inbox } from './inbox';

export default function ConversationsPage() {
  return (
    <PageGuard permission="conversation:view">
      <Suspense fallback={null}>
        <Inbox />
      </Suspense>
    </PageGuard>
  );
}
