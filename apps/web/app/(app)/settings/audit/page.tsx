'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { AuditViewer } from './audit-viewer';

export default function AuditPage() {
  return (
    <PageGuard permission="audit:view">
      <AuditViewer />
    </PageGuard>
  );
}
