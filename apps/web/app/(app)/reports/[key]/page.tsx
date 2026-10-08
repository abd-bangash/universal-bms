'use client';

import { useParams } from 'next/navigation';
import { PageGuard } from '@/components/layout/page-guard';
import { ReportView } from '../report-view';

export default function ReportPage() {
  const { key } = useParams<{ key: string }>();
  return (
    <PageGuard permission="report:view">
      <ReportView reportKey={key} />
    </PageGuard>
  );
}
