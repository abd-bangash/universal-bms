'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { IntegrationsManager } from './integrations-manager';

export default function IntegrationsPage() {
  return (
    <PageGuard permission="integration:view">
      <IntegrationsManager />
    </PageGuard>
  );
}
