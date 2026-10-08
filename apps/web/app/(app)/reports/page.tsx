'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { ReportCatalogue } from './report-catalogue';

export default function ReportsPage() {
  return (
    <PageGuard permission="report:view">
      <ReportCatalogue />
    </PageGuard>
  );
}
