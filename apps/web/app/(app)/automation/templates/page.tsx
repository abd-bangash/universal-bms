'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { TemplatesManager } from './templates-manager';

export default function TemplatesPage() {
  return (
    <PageGuard permission="template:view">
      <TemplatesManager />
    </PageGuard>
  );
}
