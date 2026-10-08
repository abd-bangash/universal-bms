'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { StaffList } from './staff-list';

export default function StaffPage() {
  return (
    <PageGuard permission="user:view">
      <StaffList />
    </PageGuard>
  );
}
